import {
  CLI_ROUTER_RESULT_KIND,
  type CliCommandPath,
  type CliHelpExample,
  type CliHelpOption,
  type CliHelpRenderContext,
  type CliHelpSurface,
  type CliHelpSurfaceLocation,
  type CliOptionValueMode,
  type CliRouterResult,
} from "./cli-model.js";
import { CLI_OPTION_KIND, CLI_OPTION_VALUE_MODE } from "./cli-values.js";
import type { ParameterRequirementDescription } from "./introspection.js";
import { PARAMETER_REQUIREMENT_KIND } from "./values.js";

const CLI_HELP_TEXT = {
  argumentsHeading: "Arguments:",
  commandArgument: "<command>",
  commandsHeading: "Commands:",
  commaOrRepeatDetail: "comma-separated or repeatable",
  defaultDetailPrefix: "default:",
  examplesHeading: "Examples:",
  expectedResultHeading: "Expected result:",
  incompleteCommandPrefix: "Incomplete command:",
  invalidInputLabel: "Invalid input",
  invalidParameterPrefix: "Invalid",
  nextStepsHeading: "Next steps:",
  optionsHeading: "Options:",
  optionalDetail: "optional",
  relatedDocumentationHeading: "Related documentation:",
  remarksHeading: "Remarks:",
  repeatableDetail: "repeatable",
  requiredDetail: "required",
  unknownCommandPrefix: "Unknown command:",
  usageHeading: "Usage:",
  useWhenPrefix: "Use when",
} as const;

const CLI_OPTION_VALUE_MODE_DETAILS = {
  [CLI_OPTION_VALUE_MODE.replace]: [],
  [CLI_OPTION_VALUE_MODE.repeat]: [CLI_HELP_TEXT.repeatableDetail],
  [CLI_OPTION_VALUE_MODE.commaOrRepeat]: [CLI_HELP_TEXT.commaOrRepeatDetail],
} as const satisfies Record<CliOptionValueMode, readonly string[]>;

const CLI_HELP_LAYOUT = {
  columnSeparator: "\t",
  commandPartSeparator: " ",
  detailSeparator: ", ",
  emptyLine: "",
  issueSeparator: "; ",
  itemIndent: "  ",
  lineSeparator: "\n",
  nestedItemIndent: "    ",
  resultIndent: "      ",
  sectionSeparator: "\n\n",
} as const;

type CliHelpSection = readonly string[];
type OptionalCliHelpSection = CliHelpSection | null;
type CliHelpRequirementDetails = readonly [string, ...string[]];

export type CliHelpOptionDescription = {
  readonly names: string;
  readonly description: string;
};

export function findCliHelpSurface(
  root: CliHelpSurface,
  commandPath: CliCommandPath,
): CliHelpSurface | null {
  return findCliHelpSurfaceLocation(root, commandPath)?.surface ?? null;
}

export function findCliHelpSurfaceLocation(
  root: CliHelpSurface,
  commandPath: CliCommandPath,
): CliHelpSurfaceLocation | null {
  let current = root;
  const path: string[] = [];
  for (const token of commandPath) {
    const child = current.children.find(
      (candidate) =>
        candidate.token === token || candidate.aliases.includes(token),
    );
    if (!child) {
      return null;
    }
    current = child;
    path.push(child.token ?? child.name);
  }
  return { surface: current, path };
}

export function renderCliHelp(
  surface: CliHelpSurface,
  context: CliHelpRenderContext,
): string {
  return joinCliHelpSections([
    createCliHelpSummarySection(surface, context.programName),
    createCliHelpCommandsSection(surface),
    createCliHelpArgumentsSection(surface),
    createCliHelpOptionsSection(surface),
    createCliHelpRemarksSection(surface),
    createCliHelpExamplesSection(surface, context.executableName),
    createCliHelpDocumentationSection(surface),
    createCliHelpNextStepsSection(surface, context.programName),
  ]);
}

export function listCliHelpSurfaces(
  root: CliHelpSurface,
): readonly CliHelpSurfaceLocation[] {
  const locations: CliHelpSurfaceLocation[] = [];
  const pending: CliHelpSurfaceLocation[] = [{ surface: root, path: [] }];
  for (const current of pending) {
    locations.push(current);
    pending.push(
      ...current.surface.children.map((child) => ({
        surface: child,
        path: [...current.path, child.token ?? child.name],
      })),
    );
  }
  return locations;
}

function joinCliHelpSections(
  sections: readonly OptionalCliHelpSection[],
): string {
  return sections
    .flatMap((section) => (section === null ? [] : [section]))
    .map((section) => section.join(CLI_HELP_LAYOUT.lineSeparator))
    .join(CLI_HELP_LAYOUT.sectionSeparator);
}

function createCliHelpSummarySection(
  surface: CliHelpSurface,
  programName: string,
): CliHelpSection {
  return [
    ...surface.usages.map(
      (usage) =>
        `${CLI_HELP_TEXT.usageHeading} ${appendCliCommandPart(programName, usage)}`,
    ),
    CLI_HELP_LAYOUT.emptyLine,
    surface.description,
  ];
}

function createCliHelpCommandsSection(
  surface: CliHelpSurface,
): OptionalCliHelpSection {
  if (surface.children.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.commandsHeading,
    ...surface.children.map((child) => {
      const names = [child.token ?? child.name, ...child.aliases].join(
        CLI_HELP_LAYOUT.detailSeparator,
      );
      return `${CLI_HELP_LAYOUT.itemIndent}${names}${CLI_HELP_LAYOUT.columnSeparator}${child.description}`;
    }),
  ];
}

function createCliHelpArgumentsSection(
  surface: CliHelpSurface,
): OptionalCliHelpSection {
  if (surface.positionals.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.argumentsHeading,
    ...surface.positionals.map(
      (positional) =>
        `${CLI_HELP_LAYOUT.itemIndent}${positional.valueName}${CLI_HELP_LAYOUT.columnSeparator}${formatCliHelpParameterDescription(
          {
            description: positional.description,
            requirement: positional.requirement,
            additionalDetails: [],
          },
        )}`,
    ),
  ];
}

function createCliHelpOptionsSection(
  surface: CliHelpSurface,
): OptionalCliHelpSection {
  if (surface.optionGroups.length === 0) {
    return null;
  }
  return [CLI_HELP_TEXT.optionsHeading, ...renderCliHelpOptions(surface)];
}

function createCliHelpRemarksSection(
  surface: CliHelpSurface,
): OptionalCliHelpSection {
  if (surface.remarks.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.remarksHeading,
    ...surface.remarks.map(
      (remark) => `${CLI_HELP_LAYOUT.itemIndent}${remark}`,
    ),
  ];
}

function createCliHelpExamplesSection(
  surface: CliHelpSurface,
  programName: string,
): OptionalCliHelpSection {
  if (surface.examples.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.examplesHeading,
    ...renderCliHelpExamples(surface.examples, programName),
  ];
}

function createCliHelpDocumentationSection(
  surface: CliHelpSurface,
): OptionalCliHelpSection {
  if (surface.relatedDocs.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.relatedDocumentationHeading,
    ...surface.relatedDocs.map(
      (documentId) => `${CLI_HELP_LAYOUT.itemIndent}${documentId}`,
    ),
  ];
}

function createCliHelpNextStepsSection(
  surface: CliHelpSurface,
  programName: string,
): OptionalCliHelpSection {
  if (surface.children.length === 0) {
    return null;
  }
  return [
    CLI_HELP_TEXT.nextStepsHeading,
    `${CLI_HELP_LAYOUT.itemIndent}${surface.subcommandHint ?? formatDefaultCliSubcommandHint(programName)}`,
  ];
}

function renderCliHelpOptions(surface: CliHelpSurface): readonly string[] {
  return surface.optionGroups.flatMap((group) => {
    const indent =
      group.heading === null
        ? CLI_HELP_LAYOUT.itemIndent
        : CLI_HELP_LAYOUT.nestedItemIndent;
    return [
      ...(group.heading === null
        ? []
        : [`${CLI_HELP_LAYOUT.itemIndent}${group.heading}`]),
      ...(group.description === null
        ? []
        : [`${CLI_HELP_LAYOUT.nestedItemIndent}${group.description}`]),
      ...group.options.map((option) => renderCliHelpOption(option, indent)),
    ];
  });
}

function renderCliHelpOption(option: CliHelpOption, indent: string): string {
  const description = describeCliHelpOption(option);
  return `${indent}${description.names}${CLI_HELP_LAYOUT.columnSeparator}${description.description}`;
}

export function describeCliHelpOption(
  option: CliHelpOption,
): CliHelpOptionDescription {
  switch (option.kind) {
    case CLI_OPTION_KIND.booleanFlag:
      return {
        names: [...option.flags, ...option.negativeFlags].join(
          CLI_HELP_LAYOUT.detailSeparator,
        ),
        description: formatCliHelpParameterDescription({
          description: option.description,
          requirement: option.requirement,
          additionalDetails: [],
        }),
      };
    case CLI_OPTION_KIND.value:
      return {
        names: `${option.flags.join(CLI_HELP_LAYOUT.detailSeparator)} <${option.valueName}>`,
        description: formatCliHelpParameterDescription({
          description: option.description,
          requirement: option.requirement,
          additionalDetails: CLI_OPTION_VALUE_MODE_DETAILS[option.valueMode],
        }),
      };
  }
}

export function appendCliCommandPart(command: string, part: string): string {
  return part.length === 0
    ? command
    : `${command}${CLI_HELP_LAYOUT.commandPartSeparator}${part}`;
}

export function formatDefaultCliSubcommandHint(programName: string): string {
  return `Run \`${programName} ${CLI_HELP_TEXT.commandArgument} --help\` for subcommand details.`;
}

export function formatCliRouterError(
  result: Extract<
    CliRouterResult,
    {
      readonly kind:
        | typeof CLI_ROUTER_RESULT_KIND.unknownCommand
        | typeof CLI_ROUTER_RESULT_KIND.incompleteCommand
        | typeof CLI_ROUTER_RESULT_KIND.invalidInput
        | typeof CLI_ROUTER_RESULT_KIND.invalidParameter;
    }
  >,
): string {
  switch (result.kind) {
    case CLI_ROUTER_RESULT_KIND.unknownCommand:
      return `${CLI_HELP_TEXT.unknownCommandPrefix} ${[
        ...result.path,
        result.token,
      ].join(CLI_HELP_LAYOUT.commandPartSeparator)}.`;
    case CLI_ROUTER_RESULT_KIND.incompleteCommand:
      return `${CLI_HELP_TEXT.incompleteCommandPrefix} ${result.path.join(CLI_HELP_LAYOUT.commandPartSeparator)}.`;
    case CLI_ROUTER_RESULT_KIND.invalidInput:
      return `${CLI_HELP_TEXT.invalidInputLabel}: ${result.issues.join(CLI_HELP_LAYOUT.issueSeparator)}`;
    case CLI_ROUTER_RESULT_KIND.invalidParameter:
      return `${CLI_HELP_TEXT.invalidParameterPrefix} ${result.parameterName}: ${result.issues.join(CLI_HELP_LAYOUT.issueSeparator)}`;
  }
}

export function formatCliHelpParameterDescription(input: {
  readonly description: string;
  readonly requirement: ParameterRequirementDescription;
  readonly additionalDetails: readonly string[];
}): string {
  const [presenceDetail, ...defaultDetails] = formatParameterRequirementDetails(
    input.requirement,
  );
  const details = [
    presenceDetail,
    ...input.additionalDetails,
    ...defaultDetails,
  ];
  return `${input.description} (${details.join(CLI_HELP_LAYOUT.detailSeparator)})`;
}

export function renderCliHelpExamples(
  examples: readonly CliHelpExample[],
  executableName: string,
): readonly string[] {
  return examples.flatMap((example, index) => [
    ...(index === 0 ? [] : [CLI_HELP_LAYOUT.emptyLine]),
    `${CLI_HELP_LAYOUT.itemIndent}${example.title}:`,
    `${CLI_HELP_LAYOUT.nestedItemIndent}${CLI_HELP_TEXT.useWhenPrefix} ${example.useWhen}`,
    CLI_HELP_LAYOUT.emptyLine,
    `${CLI_HELP_LAYOUT.nestedItemIndent}${appendCliCommandPart(executableName, example.command)}`,
    ...(example.expectedResult.length === 0
      ? []
      : [
          CLI_HELP_LAYOUT.emptyLine,
          `${CLI_HELP_LAYOUT.nestedItemIndent}${CLI_HELP_TEXT.expectedResultHeading}`,
          ...example.expectedResult.map(
            (line) => `${CLI_HELP_LAYOUT.resultIndent}${line}`,
          ),
        ]),
  ]);
}

function formatParameterRequirementDetails(
  requirement: ParameterRequirementDescription,
): CliHelpRequirementDetails {
  switch (requirement.kind) {
    case PARAMETER_REQUIREMENT_KIND.required:
      return [CLI_HELP_TEXT.requiredDetail];
    case PARAMETER_REQUIREMENT_KIND.optional:
      return [CLI_HELP_TEXT.optionalDetail];
    case PARAMETER_REQUIREMENT_KIND.optionalWithDefault:
      return [
        CLI_HELP_TEXT.optionalDetail,
        `${CLI_HELP_TEXT.defaultDetailPrefix} ${JSON.stringify(requirement.defaultValue)}`,
      ];
  }
}
