import type {
  CompiledCliEndpoint,
  CompiledCliOption,
  CompiledCliPositional,
} from "./cli-compiler.js";
import type {
  CliHelpExample,
  CliHelpOption,
  CliHelpOptionSection,
  CliHelpPositional,
  CliHelpSurface,
  CliHelpUsage,
  CliHelpUsageList,
  CliSegment,
} from "./cli-model.js";
import {
  CLI_HELP_USAGE_KIND,
  CLI_OPTION_KIND,
  CLI_POSITIONAL_PLAN_KIND,
} from "./cli-values.js";
import { describeParameterRequirement } from "./introspection.js";
import type { EntryTreeNode } from "./model.js";
import { PARAMETER_REQUIREMENT_KIND } from "./values.js";

const CLI_HELP_ENDPOINT_KIND = {
  executable: "executable",
  group: "group",
} as const;

const CLI_HELP_USAGE_SYNTAX = {
  commandArgument: "<command>",
  commandPartSeparator: " ",
  emptyPart: "",
  optionArgument: "[options]",
  optionalClose: "]",
  optionalOpen: "[",
  requiredClose: ">",
  requiredOpen: "<",
  variadicSuffix: "...",
} as const;

const CLI_HELP_VALIDATION_ISSUE = {
  duplicateSectionParameter: (location: string, parameterName: string) =>
    `${location}: help option parameter ${parameterName} appears more than once in option sections`,
  emptyExampleCommand: "CLI help example command must not be empty",
  emptyExampleTitle: "CLI help example title must not be empty",
  nonOptionSectionParameter: (
    location: string,
    heading: string,
    parameterName: string,
  ) =>
    `${location}: help option section ${JSON.stringify(heading)} names non-option parameter ${parameterName}`,
} as const;

type CliEndpointHelpProjection =
  | {
      readonly kind: typeof CLI_HELP_ENDPOINT_KIND.group;
      readonly examples: readonly [];
      readonly options: readonly [];
      readonly optionSections: readonly [];
      readonly positionals: readonly [];
      readonly usage: { readonly kind: typeof CLI_HELP_USAGE_KIND.derived };
    }
  | {
      readonly kind: typeof CLI_HELP_ENDPOINT_KIND.executable;
      readonly examples: readonly CliHelpExample[];
      readonly options: readonly CliHelpOption[];
      readonly optionSections: readonly CliHelpOptionSection[];
      readonly positionals: readonly CliHelpPositional[];
      readonly usage: CliHelpUsage;
    };

const GROUP_HELP_PROJECTION = {
  kind: CLI_HELP_ENDPOINT_KIND.group,
  examples: [],
  options: [],
  optionSections: [],
  positionals: [],
  usage: { kind: CLI_HELP_USAGE_KIND.derived },
} as const satisfies CliEndpointHelpProjection;

export function createCliHelpSurface(input: {
  readonly node: EntryTreeNode;
  readonly segment: CliSegment;
  readonly endpoint: CompiledCliEndpoint | null;
  readonly childHelp: readonly CliHelpSurface[];
  readonly root: boolean;
}): CliHelpSurface {
  const endpoint = projectCliEndpointHelp(input.endpoint);
  const hasChildren = input.childHelp.length > 0;
  return {
    name: input.node.name,
    token: input.root ? null : input.segment.token,
    aliases: input.root ? [] : input.segment.aliases,
    description: input.node.description,
    remarks: input.node.documentation.remarks,
    relatedDocs: input.node.documentation.relatedDocs,
    executable: endpoint.kind === CLI_HELP_ENDPOINT_KIND.executable,
    options: endpoint.options,
    positionals: endpoint.positionals,
    usages: resolveCliUsages(endpoint, hasChildren),
    examples: [...input.segment.help.examples, ...endpoint.examples],
    optionSections: endpoint.optionSections,
    subcommandHint: input.segment.help.subcommandHint,
    children: input.childHelp,
  };
}

export function validateCliCommandHelp(
  endpoint: CompiledCliEndpoint,
  location: string,
  issues: string[],
): void {
  const { help, options } = endpoint;
  validateCliHelpExamples(help.examples, location, issues);
  const optionNames = new Set(options.map((option) => option.parameter.name));
  const sectionedNames = new Set<string>();
  for (const section of help.optionSections) {
    for (const parameterName of section.parameterNames) {
      if (!optionNames.has(parameterName)) {
        issues.push(
          CLI_HELP_VALIDATION_ISSUE.nonOptionSectionParameter(
            location,
            section.heading,
            parameterName,
          ),
        );
      }
      if (sectionedNames.has(parameterName)) {
        issues.push(
          CLI_HELP_VALIDATION_ISSUE.duplicateSectionParameter(
            location,
            parameterName,
          ),
        );
      }
      sectionedNames.add(parameterName);
    }
  }
}

export function validateCliHelpExamples(
  examples: readonly CliHelpExample[],
  location: string,
  issues: string[],
): void {
  for (const example of examples) {
    if (example.title.length === 0) {
      issues.push(
        `${location}: ${CLI_HELP_VALIDATION_ISSUE.emptyExampleTitle}`,
      );
    }
    if (example.command.length === 0) {
      issues.push(
        `${location}: ${CLI_HELP_VALIDATION_ISSUE.emptyExampleCommand}`,
      );
    }
  }
}

function projectCliEndpointHelp(
  endpoint: CompiledCliEndpoint | null,
): CliEndpointHelpProjection {
  if (endpoint === null) {
    return GROUP_HELP_PROJECTION;
  }
  return {
    kind: CLI_HELP_ENDPOINT_KIND.executable,
    examples: endpoint.help.examples,
    options: endpoint.options.map(cliHelpOptionFor),
    optionSections: endpoint.help.optionSections,
    positionals: endpoint.positionals.map(cliHelpPositionalFor),
    usage: endpoint.help.usage,
  };
}

function resolveCliUsages(
  endpoint: CliEndpointHelpProjection,
  hasChildren: boolean,
): CliHelpUsageList {
  switch (endpoint.usage.kind) {
    case CLI_HELP_USAGE_KIND.authored:
      return endpoint.usage.values;
    case CLI_HELP_USAGE_KIND.derived:
      return [deriveCliUsage(endpoint, hasChildren)];
  }
}

function deriveCliUsage(
  endpoint: CliEndpointHelpProjection,
  hasChildren: boolean,
): string {
  const parts: string[] = [];
  if (endpoint.options.length > 0) {
    parts.push(CLI_HELP_USAGE_SYNTAX.optionArgument);
  }
  parts.push(...endpoint.positionals.map(formatCliUsagePositional));
  if (hasChildren) {
    parts.push(CLI_HELP_USAGE_SYNTAX.commandArgument);
  }
  return parts.join(CLI_HELP_USAGE_SYNTAX.commandPartSeparator);
}

function formatCliUsagePositional(positional: CliHelpPositional): string {
  const name = `${positional.valueName}${
    positional.variadic
      ? CLI_HELP_USAGE_SYNTAX.variadicSuffix
      : CLI_HELP_USAGE_SYNTAX.emptyPart
  }`;
  return positional.requirement.kind === PARAMETER_REQUIREMENT_KIND.required
    ? `${CLI_HELP_USAGE_SYNTAX.requiredOpen}${name}${CLI_HELP_USAGE_SYNTAX.requiredClose}`
    : `${CLI_HELP_USAGE_SYNTAX.optionalOpen}${name}${CLI_HELP_USAGE_SYNTAX.optionalClose}`;
}

function cliHelpOptionFor(option: CompiledCliOption): CliHelpOption {
  const base = {
    parameterName: option.parameter.name,
    flags: option.flags,
    description: option.parameter.description,
    requirement: describeParameterRequirement(option.parameter.requirement),
  };
  return option.kind === CLI_OPTION_KIND.booleanFlag
    ? {
        ...base,
        kind: CLI_OPTION_KIND.booleanFlag,
        negativeFlags: option.negativeFlags,
      }
    : {
        ...base,
        kind: CLI_OPTION_KIND.value,
        valueName: option.valueName,
        valueMode: option.valueMode,
      };
}

function cliHelpPositionalFor(
  positional: CompiledCliPositional,
): CliHelpPositional {
  return {
    parameterName: positional.parameter.name,
    valueName: positional.valueName,
    description: positional.parameter.description,
    requirement: describeParameterRequirement(positional.parameter.requirement),
    variadic: positional.kind === CLI_POSITIONAL_PLAN_KIND.rest,
  };
}
