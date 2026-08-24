import {
  type CompiledParameterBinding,
  compileParameterBindings,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import {
  CLI_ARG_KIND,
  type CliArgBinding,
  type CliEntryBinding,
  type CliLongOptionFlag,
  type CliOptionFlag,
  type CliOptionValueMode,
  type CliValueCoercion,
} from "./cli-model.js";
import {
  CLI_BOOLEAN_MODE,
  CLI_OPTION_KIND,
  CLI_OPTION_VALUE_MODE,
  CLI_POSITIONAL_PLAN_KIND,
} from "./cli-values.js";
import type { EntryTreeEndpoint, ErasedParameterDefinition } from "./model.js";
import { PARAMETER_REQUIREMENT_KIND, VALUE_SHAPE_KIND } from "./values.js";

export const CLI_OPTION_ACTION_KIND = {
  setBoolean: "set_boolean",
  readValue: "read_value",
} as const;

const CLI_COMPILER_SYNTAX = {
  assignmentSeparator: "=",
  invalidLongOptionPrefix: "---",
  longOptionPrefix: "--",
  negatedLongOptionPrefix: "--no-",
  optionPrefix: "-",
} as const;

type CompiledCliOptionBase = {
  readonly parameter: ErasedParameterDefinition;
  readonly flags: readonly CliOptionFlag[];
  readonly coercion: CliValueCoercion | null;
};

export type CompiledCliOption =
  | (CompiledCliOptionBase & {
      readonly kind: typeof CLI_OPTION_KIND.booleanFlag;
      readonly negativeFlags: readonly CliLongOptionFlag[];
    })
  | (CompiledCliOptionBase & {
      readonly kind: typeof CLI_OPTION_KIND.value;
      readonly valueMode: CliOptionValueMode;
      readonly valueName: string;
    });

export type CompiledCliPositional = {
  readonly kind:
    | typeof CLI_POSITIONAL_PLAN_KIND.single
    | typeof CLI_POSITIONAL_PLAN_KIND.rest;
  readonly parameter: ErasedParameterDefinition;
  readonly valueName: string;
  readonly coercion: CliValueCoercion | null;
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
        { readonly kind: typeof CLI_OPTION_KIND.value }
      >;
    };

export type CompiledCliEndpoint = {
  readonly endpoint: EntryTreeEndpoint;
  readonly binding: CliEntryBinding;
  readonly help: CliEntryBinding["help"];
  readonly options: readonly CompiledCliOption[];
  readonly positionals: readonly CompiledCliPositional[];
  readonly optionByToken: ReadonlyMap<string, CliOptionAction>;
};

export function compileCliBinding(
  endpoint: EntryTreeEndpoint,
  binding: CliEntryBinding,
  location: string,
  issues: string[],
): CompiledCliEndpoint {
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
    binding,
    help: binding.help,
    options,
    positionals,
    optionByToken: createCliOptionActionIndex(options, location, issues),
  };
}

function compileCliOption(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.option }>
  >,
  location: string,
  issues: string[],
): CompiledCliOption {
  const { row, parameter } = compiled;
  const flags = row.flags;
  if (flags.length === 0) {
    issues.push(`${location}: option ${row.parameterName} must declare a flag`);
  }
  for (const flag of flags) {
    if (!isReachableCliOptionFlag(flag)) {
      issues.push(
        `${location}: option ${row.parameterName} declares unreachable CLI flag ${JSON.stringify(flag)}`,
      );
    }
  }
  if (row.valueName.length === 0) {
    issues.push(
      `${location}: option ${row.parameterName} valueName must not be empty`,
    );
  }
  switch (parameter.codec.shape.kind) {
    case VALUE_SHAPE_KIND.boolean:
      return compileCliBooleanOption(compiled, flags, location, issues);
    case VALUE_SHAPE_KIND.array:
      rejectBooleanChoices(row, location, issues);
      return {
        kind: CLI_OPTION_KIND.value,
        parameter,
        flags,
        coercion: row.coercion,
        valueName: row.valueName,
        valueMode: row.repeatable
          ? CLI_OPTION_VALUE_MODE.commaOrRepeat
          : CLI_OPTION_VALUE_MODE.repeat,
      };
    case VALUE_SHAPE_KIND.positiveInteger:
    case VALUE_SHAPE_KIND.string:
    case VALUE_SHAPE_KIND.stringEnum:
      rejectBooleanChoices(row, location, issues);
      if (row.repeatable) {
        issues.push(
          `${location}: repeatMode contradicts ${row.parameterName} codec shape`,
        );
      }
      return {
        kind: CLI_OPTION_KIND.value,
        parameter,
        flags,
        coercion: row.coercion,
        valueName: row.valueName,
        valueMode: CLI_OPTION_VALUE_MODE.replace,
      };
  }
}

function isReachableCliOptionFlag(flag: string): boolean {
  return (
    flag.startsWith(CLI_COMPILER_SYNTAX.optionPrefix) &&
    flag !== CLI_COMPILER_SYNTAX.optionPrefix &&
    flag !== CLI_COMPILER_SYNTAX.longOptionPrefix &&
    !flag.startsWith(CLI_COMPILER_SYNTAX.invalidLongOptionPrefix) &&
    !flag.includes(CLI_COMPILER_SYNTAX.assignmentSeparator) &&
    !/\s/.test(flag)
  );
}

function compileCliBooleanOption(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.option }>
  >,
  flags: readonly CliOptionFlag[],
  location: string,
  issues: string[],
): CompiledCliOption {
  const { row, parameter } = compiled;
  if (row.repeatable) {
    issues.push(
      `${location}: repeatMode contradicts ${row.parameterName} codec shape`,
    );
  }
  const booleanMode =
    row.booleanMode ??
    (parameter.requirement.kind ===
    PARAMETER_REQUIREMENT_KIND.optionalWithDefault
      ? CLI_BOOLEAN_MODE.flag
      : CLI_BOOLEAN_MODE.value);
  if (booleanMode === CLI_BOOLEAN_MODE.value) {
    if (row.negated) {
      issues.push(
        `${location}: negated option ${row.parameterName} requires flag booleanMode`,
      );
    }
    return {
      kind: CLI_OPTION_KIND.value,
      parameter,
      flags,
      coercion: row.coercion,
      valueName: row.valueName,
      valueMode: CLI_OPTION_VALUE_MODE.replace,
    };
  }
  if (row.valueNameAuthored) {
    issues.push(
      `${location}: valueName contradicts flag booleanMode for ${row.parameterName}`,
    );
  }
  if (row.coercion !== null) {
    issues.push(
      `${location}: coercion contradicts flag booleanMode for ${row.parameterName}`,
    );
  }
  const negativeFlags = row.negated
    ? flags.filter(isCliLongOptionFlag).map(negateCliLongOptionFlag)
    : [];
  if (row.negated && negativeFlags.length === 0) {
    issues.push(
      `${location}: negated option ${row.parameterName} requires a long flag`,
    );
  }
  return {
    kind: CLI_OPTION_KIND.booleanFlag,
    parameter,
    flags,
    coercion: null,
    negativeFlags,
  };
}

function isCliLongOptionFlag(flag: CliOptionFlag): flag is CliLongOptionFlag {
  return flag.startsWith(CLI_COMPILER_SYNTAX.longOptionPrefix);
}

function negateCliLongOptionFlag(flag: CliLongOptionFlag): CliLongOptionFlag {
  return `${CLI_COMPILER_SYNTAX.negatedLongOptionPrefix}${flag.slice(CLI_COMPILER_SYNTAX.longOptionPrefix.length)}`;
}

function rejectBooleanChoices(
  row: Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.option }>,
  location: string,
  issues: string[],
): void {
  if (row.booleanMode !== null) {
    issues.push(
      `${location}: booleanMode contradicts ${row.parameterName} codec shape`,
    );
  }
  if (row.negated) {
    issues.push(
      `${location}: negated contradicts ${row.parameterName} codec shape`,
    );
  }
}

function compileCliPositional(
  compiled: CompiledParameterBinding<
    Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.positional }>
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
    coercion: row.coercion,
  };
}

function createCliOptionActionIndex(
  options: readonly CompiledCliOption[],
  location: string,
  issues: string[],
): ReadonlyMap<string, CliOptionAction> {
  const actions = new Map<string, CliOptionAction>();
  for (const option of options) {
    if (option.kind === CLI_OPTION_KIND.booleanFlag) {
      for (const token of option.flags) {
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
