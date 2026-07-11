import type { JsonValue } from "@alpacaloop/core";
import {
  type CompiledParameterBinding,
  compileParameterBindings,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import {
  CLI_ARG_KIND,
  CLI_REPEAT_MODE,
  type CliArgBinding,
  type CliBooleanMode,
  type CliEntryBinding,
  type CliHelpOption,
  type CliHelpSurface,
  type CliSegment,
} from "./cli-model.js";
import { CLI_BOOLEAN_MODE } from "./cli-values.js";
import type {
  EntryTreeEndpoint,
  EntryTreeNode,
  ParameterDefinition,
} from "./model.js";
import { formatTreePath } from "./schema.js";
import { PARAMETER_PRESENCE, VALUE_SHAPE_KIND } from "./values.js";

export const CLI_OPTION_PLAN_KIND = {
  booleanFlag: "boolean_flag",
  value: "value",
} as const;

export const CLI_OPTION_VALUE_MODE = {
  replace: "replace",
  repeat: "repeat",
  commaOrRepeat: "comma_or_repeat",
} as const;

export const CLI_OPTION_ACTION_KIND = {
  setBoolean: "set_boolean",
  readValue: "read_value",
} as const;

export const CLI_POSITIONAL_PLAN_KIND = {
  single: "single",
  rest: "rest",
} as const;

interface CompiledCliOptionBase {
  readonly parameter: ParameterDefinition<string, JsonValue>;
  readonly flags: readonly string[];
}

export type CompiledCliOption =
  | (CompiledCliOptionBase & {
      readonly kind: typeof CLI_OPTION_PLAN_KIND.booleanFlag;
      readonly positiveFlags: readonly string[];
      readonly negativeFlags: readonly string[];
    })
  | (CompiledCliOptionBase & {
      readonly kind: typeof CLI_OPTION_PLAN_KIND.value;
      readonly valueMode:
        | typeof CLI_OPTION_VALUE_MODE.replace
        | typeof CLI_OPTION_VALUE_MODE.repeat
        | typeof CLI_OPTION_VALUE_MODE.commaOrRepeat;
      readonly booleanMode: CliBooleanMode | null;
    });

export type CompiledCliPositional = {
  readonly kind:
    | typeof CLI_POSITIONAL_PLAN_KIND.single
    | typeof CLI_POSITIONAL_PLAN_KIND.rest;
  readonly parameter: ParameterDefinition<string, JsonValue>;
  readonly valueName: string;
};

export type CliOptionAction =
  | {
      readonly kind: typeof CLI_OPTION_ACTION_KIND.setBoolean;
      readonly parameterName: string;
      readonly value: boolean;
    }
  | {
      readonly kind: typeof CLI_OPTION_ACTION_KIND.readValue;
      readonly option: Extract<
        CompiledCliOption,
        { readonly kind: typeof CLI_OPTION_PLAN_KIND.value }
      >;
    };

export interface CompiledCliEndpoint {
  readonly endpoint: EntryTreeEndpoint;
  readonly parameterNames: readonly string[];
  readonly options: readonly CompiledCliOption[];
  readonly positionals: readonly CompiledCliPositional[];
  readonly optionByToken: ReadonlyMap<string, CliOptionAction>;
}

export function compileCliBinding(
  endpoint: EntryTreeEndpoint,
  binding: CliEntryBinding,
  path: readonly string[],
  issues: string[],
): CompiledCliEndpoint {
  const location = `${formatTreePath(path)}#${endpoint.entry.name}`;
  const compiledParameters = compileParameterBindings(
    endpoint.entry,
    binding.parameters,
  );
  issues.push(
    ...compiledParameters.issues.map((issue) =>
      formatCliParameterBindingIssue(location, issue),
    ),
  );
  const options: CompiledCliOption[] = [];
  const positionals: CompiledCliPositional[] = [];
  for (const compiled of compiledParameters.bindings) {
    if (compiled.row.kind === CLI_ARG_KIND.option) {
      options.push(
        compileCliOption(
          { row: compiled.row, parameter: compiled.parameter },
          location,
          issues,
        ),
      );
    } else {
      positionals.push(
        compileCliPositional(
          { row: compiled.row, parameter: compiled.parameter },
          location,
          issues,
        ),
      );
    }
  }
  for (const [index, positional] of positionals.entries()) {
    if (
      positional.kind === CLI_POSITIONAL_PLAN_KIND.rest &&
      index !== positionals.length - 1
    ) {
      issues.push(
        `${location}: variadic positional ${positional.parameter.name} must be last`,
      );
    }
  }
  return {
    endpoint,
    parameterNames: binding.parameters.map((row) => row.parameterName),
    options,
    positionals,
    optionByToken: createCliOptionActionIndex(options, location, issues),
  };
}

function compileCliOption(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: "option" }>
  >,
  location: string,
  issues: string[],
): CompiledCliOption {
  const { row, parameter } = compiled;
  if (row.flags.length === 0) {
    issues.push(`${location}: option ${row.parameterName} must declare a flag`);
  }
  switch (parameter.codec.shape.kind) {
    case VALUE_SHAPE_KIND.boolean:
      return compileCliBooleanOption(compiled, location, issues);
    case VALUE_SHAPE_KIND.array:
      rejectBooleanChoices(row, location, issues);
      return {
        kind: CLI_OPTION_PLAN_KIND.value,
        parameter,
        flags: row.flags,
        valueMode:
          row.repeatMode === CLI_REPEAT_MODE.commaOrRepeat
            ? CLI_OPTION_VALUE_MODE.commaOrRepeat
            : CLI_OPTION_VALUE_MODE.repeat,
        booleanMode: null,
      };
    case VALUE_SHAPE_KIND.positiveInteger:
    case VALUE_SHAPE_KIND.string:
    case VALUE_SHAPE_KIND.stringEnum:
      rejectBooleanChoices(row, location, issues);
      if (row.repeatMode !== undefined) {
        issues.push(
          `${location}: repeatMode contradicts ${row.parameterName} codec shape`,
        );
      }
      return {
        kind: CLI_OPTION_PLAN_KIND.value,
        parameter,
        flags: row.flags,
        valueMode: CLI_OPTION_VALUE_MODE.replace,
        booleanMode: null,
      };
  }
}

function compileCliBooleanOption(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: "option" }>
  >,
  location: string,
  issues: string[],
): CompiledCliOption {
  const { row, parameter } = compiled;
  if (row.repeatMode !== undefined) {
    issues.push(
      `${location}: repeatMode contradicts ${row.parameterName} codec shape`,
    );
  }
  const booleanMode =
    row.booleanMode ??
    (parameter.requirement.defaultValue === undefined
      ? CLI_BOOLEAN_MODE.value
      : CLI_BOOLEAN_MODE.flag);
  if (booleanMode === CLI_BOOLEAN_MODE.value) {
    if (row.negated) {
      issues.push(
        `${location}: negated option ${row.parameterName} requires flag booleanMode`,
      );
    }
    return {
      kind: CLI_OPTION_PLAN_KIND.value,
      parameter,
      flags: row.flags,
      valueMode: CLI_OPTION_VALUE_MODE.replace,
      booleanMode,
    };
  }
  const negativeFlags = row.negated
    ? row.flags
        .filter((flag) => flag.startsWith("--"))
        .map((flag) => `--no-${flag.slice(2)}`)
    : [];
  if (row.negated && negativeFlags.length === 0) {
    issues.push(
      `${location}: negated option ${row.parameterName} requires a long flag`,
    );
  }
  return {
    kind: CLI_OPTION_PLAN_KIND.booleanFlag,
    parameter,
    flags: row.flags,
    positiveFlags: row.flags,
    negativeFlags,
  };
}

function rejectBooleanChoices(
  row: Extract<CliArgBinding, { readonly kind: "option" }>,
  location: string,
  issues: string[],
): void {
  if (row.booleanMode !== undefined) {
    issues.push(
      `${location}: booleanMode contradicts ${row.parameterName} codec shape`,
    );
  }
  if (row.negated !== undefined) {
    issues.push(
      `${location}: negated contradicts ${row.parameterName} codec shape`,
    );
  }
}

function compileCliPositional(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: "positional" }>
  >,
  location: string,
  issues: string[],
): CompiledCliPositional {
  const { row, parameter } = compiled;
  if (row.variadic && parameter.codec.shape.kind !== VALUE_SHAPE_KIND.array) {
    issues.push(
      `${location}: variadic positional ${row.parameterName} requires an array codec`,
    );
  }
  if (row.valueName.length === 0) {
    issues.push(
      `${location}: positional ${row.parameterName} valueName must not be empty`,
    );
  }
  return {
    kind: row.variadic
      ? CLI_POSITIONAL_PLAN_KIND.rest
      : CLI_POSITIONAL_PLAN_KIND.single,
    parameter,
    valueName: row.valueName,
  };
}

function createCliOptionActionIndex(
  options: readonly CompiledCliOption[],
  location: string,
  issues: string[],
): ReadonlyMap<string, CliOptionAction> {
  const actions = new Map<string, CliOptionAction>();
  for (const option of options) {
    if (option.kind === CLI_OPTION_PLAN_KIND.booleanFlag) {
      for (const token of option.positiveFlags) {
        registerCliOptionAction(
          actions,
          token,
          {
            kind: CLI_OPTION_ACTION_KIND.setBoolean,
            parameterName: option.parameter.name,
            value: true,
          },
          location,
          issues,
        );
      }
      for (const token of option.negativeFlags) {
        registerCliOptionAction(
          actions,
          token,
          {
            kind: CLI_OPTION_ACTION_KIND.setBoolean,
            parameterName: option.parameter.name,
            value: false,
          },
          location,
          issues,
        );
      }
      continue;
    }
    for (const token of option.flags) {
      registerCliOptionAction(
        actions,
        token,
        { kind: CLI_OPTION_ACTION_KIND.readValue, option },
        location,
        issues,
      );
    }
  }
  return actions;
}

function registerCliOptionAction(
  actions: Map<string, CliOptionAction>,
  token: string,
  action: CliOptionAction,
  location: string,
  issues: string[],
): void {
  if (actions.has(token)) {
    issues.push(`${location}: duplicate CLI option flag ${token}`);
    return;
  }
  actions.set(token, action);
}

function formatCliParameterBindingIssue(
  location: string,
  issue: ParameterBindingIssue,
): string {
  switch (issue.kind) {
    case PARAMETER_BINDING_ISSUE_KIND.duplicate:
      return `${location}: duplicate binding for parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistent:
      return `${location}: binding names nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable:
      return `${location}: required parameter ${issue.parameterName} is unreachable from CLI`;
  }
}

export function createCliHelpSurface(input: {
  readonly node: EntryTreeNode;
  readonly segment: CliSegment;
  readonly endpoint: CompiledCliEndpoint | null;
  readonly childHelp: readonly CliHelpSurface[];
  readonly root: boolean;
}): CliHelpSurface {
  return {
    name: input.node.name,
    token: input.root ? null : input.segment.token,
    aliases: input.root ? [] : input.segment.aliases,
    description: input.node.description,
    executable: input.endpoint !== null,
    options: (input.endpoint?.options ?? []).map(cliHelpOptionFor),
    positionals: (input.endpoint?.positionals ?? []).map((positional) => ({
      parameterName: positional.parameter.name,
      valueName: positional.valueName,
      description: positional.parameter.description,
      required:
        positional.parameter.requirement.presence ===
        PARAMETER_PRESENCE.required,
      variadic: positional.kind === CLI_POSITIONAL_PLAN_KIND.rest,
      defaultValue: positional.parameter.requirement.defaultValue,
    })),
    children: input.childHelp,
  };
}

function cliHelpOptionFor(option: CompiledCliOption): CliHelpOption {
  const booleanFlag = option.kind === CLI_OPTION_PLAN_KIND.booleanFlag;
  return {
    parameterName: option.parameter.name,
    flags: option.flags,
    description: option.parameter.description,
    required:
      option.parameter.requirement.presence === PARAMETER_PRESENCE.required,
    booleanMode: booleanFlag ? CLI_BOOLEAN_MODE.flag : option.booleanMode,
    negated: booleanFlag && option.negativeFlags.length > 0,
    repeatMode: cliHelpRepeatMode(option),
    defaultValue: option.parameter.requirement.defaultValue,
  };
}

function cliHelpRepeatMode(
  option: CompiledCliOption,
): CliHelpOption["repeatMode"] {
  if (option.kind === CLI_OPTION_PLAN_KIND.booleanFlag) {
    return null;
  }
  switch (option.valueMode) {
    case CLI_OPTION_VALUE_MODE.replace:
      return null;
    case CLI_OPTION_VALUE_MODE.repeat:
      return CLI_REPEAT_MODE.repeat;
    case CLI_OPTION_VALUE_MODE.commaOrRepeat:
      return CLI_REPEAT_MODE.commaOrRepeat;
  }
}
