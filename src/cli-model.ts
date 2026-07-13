import { registerAuthoredCliValueName } from "./cli-internal.js";
import {
  type CLI_BOOLEAN_MODE,
  CLI_HELP_USAGE_KIND,
  type CLI_OPTION_KIND,
  CLI_OPTION_VALUE_MODE,
  defaultCliOptionFlag,
  defaultCliValueName,
} from "./cli-values.js";
import type { ParameterRequirementDescription } from "./introspection.js";
import type {
  ChannelSegmentOverride,
  EntryChannelBinding,
  EntryTreeEndpoint,
} from "./model.js";
import {
  createChannelSegmentOverride,
  createEntryChannelBinding,
  PAYLOAD_KIND,
  registerChannelPayload,
} from "./tree-internal.js";
import { CHANNEL } from "./values.js";

export const CLI_ARG_KIND = {
  option: "option",
  positional: "positional",
} as const;

export const CLI_VALUE_COERCION = {
  json: "json",
  jsonOrString: "json_or_string",
} as const;

export const CLI_ROUTER_RESULT_KIND = {
  resolved: "resolved",
  unknownCommand: "unknown_command",
  incompleteCommand: "incomplete_command",
  invalidInput: "invalid_input",
  invalidParameter: "invalid_parameter",
  internalError: "internal_error",
} as const;

export type CliBooleanMode =
  (typeof CLI_BOOLEAN_MODE)[keyof typeof CLI_BOOLEAN_MODE];

export type CliOptionValueMode =
  (typeof CLI_OPTION_VALUE_MODE)[keyof typeof CLI_OPTION_VALUE_MODE];

export type CliValueCoercion =
  (typeof CLI_VALUE_COERCION)[keyof typeof CLI_VALUE_COERCION];

export type CliLongOptionFlag = `--${string}`;
export type CliOptionFlag = `-${string}`;

/** CLI segment-token path. Surface locations always use canonical tokens. */
export type CliCommandPath = readonly string[];

export type CliArgBindingInput<Name extends string = string> =
  | {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly parameterName: Name;
      /** Defaults to `--<kebab-case parameter name>` when omitted. */
      readonly flags?: readonly CliOptionFlag[];
      /** Displayed after the option flag. Defaults from `parameterName`. */
      readonly valueName?: string;
      /** Overrides the default scalar coercion performed for CLI strings. */
      readonly coercion?: CliValueCoercion;
      readonly booleanMode?: CliBooleanMode;
      readonly negated?: true;
      readonly repeatMode?: typeof CLI_OPTION_VALUE_MODE.commaOrRepeat;
    }
  | {
      readonly kind: typeof CLI_ARG_KIND.positional;
      readonly parameterName: Name;
      /** Defaults to the upper snake-cased parameter name when omitted. */
      readonly valueName?: string;
      /** Overrides the default scalar coercion performed for CLI strings. */
      readonly coercion?: CliValueCoercion;
      /** Defaults to `false` when omitted. */
      readonly variadic?: boolean;
    };

export type CliArgBinding<Name extends string = string> =
  | {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly parameterName: Name;
      readonly flags: readonly CliOptionFlag[];
      readonly valueName: string;
      readonly coercion: CliValueCoercion | null;
      readonly booleanMode: CliBooleanMode | null;
      readonly negated: boolean;
      readonly repeatable: boolean;
    }
  | {
      readonly kind: typeof CLI_ARG_KIND.positional;
      readonly parameterName: Name;
      readonly valueName: string;
      readonly coercion: CliValueCoercion | null;
      readonly variadic: boolean;
    };

export type CliEntryBinding<Name extends string = string> = {
  readonly parameters: readonly CliArgBinding<Name>[];
  readonly help: CliCommandHelp;
};

export type CliSegment = {
  readonly token: string;
  readonly aliases: readonly string[];
  readonly help: CliGroupHelp;
};

export type CliHelpExample = {
  readonly title: string;
  readonly useWhen: string;
  readonly command: string;
  readonly expectedResult: readonly string[];
};

export type CliHelpExampleInput = {
  readonly title: string;
  readonly useWhen: string;
  readonly command: string;
  readonly expectedResult?: readonly string[];
};

export type CliHelpOptionSection = {
  readonly heading: string;
  readonly description: string | null;
  readonly parameterNames: readonly string[];
};

export type CliHelpOptionSectionInput<ParameterName extends string = string> = {
  readonly heading: string;
  readonly description?: string;
  readonly parameterNames: readonly ParameterName[];
};

export type CliHelpUsageList = readonly [string, ...string[]];

export type CliHelpUsage =
  | { readonly kind: typeof CLI_HELP_USAGE_KIND.derived }
  | {
      readonly kind: typeof CLI_HELP_USAGE_KIND.authored;
      readonly values: CliHelpUsageList;
    };

export type CliCommandHelp = {
  readonly usage: CliHelpUsage;
  readonly examples: readonly CliHelpExample[];
  readonly optionSections: readonly CliHelpOptionSection[];
};

export type CliCommandHelpInput<OptionParameterName extends string = string> = {
  readonly usages?: CliHelpUsageList;
  readonly examples?: readonly CliHelpExampleInput[];
  readonly optionSections?: readonly CliHelpOptionSectionInput<OptionParameterName>[];
};

export type CliGroupHelp = {
  readonly subcommandHint: string | null;
  readonly examples: readonly CliHelpExample[];
};

export type CliGroupHelpInput = {
  readonly subcommandHint?: string;
  readonly examples?: readonly CliHelpExampleInput[];
};

type CliOptionParameterName<Bindings extends readonly CliArgBindingInput[]> =
  Extract<
    Bindings[number],
    { readonly kind: typeof CLI_ARG_KIND.option }
  >["parameterName"];

export function bindCliEntry<
  const Bindings extends readonly CliArgBindingInput[],
>(binding: {
  readonly parameters: Bindings;
  readonly help?: CliCommandHelpInput<CliOptionParameterName<Bindings>>;
}): EntryChannelBinding<typeof CHANNEL.cli, Bindings[number]["parameterName"]> {
  const payload = {
    parameters: binding.parameters.map(normalizeCliArgBinding),
    help: normalizeCliCommandHelp(binding.help),
  } satisfies CliEntryBinding;
  registerChannelPayload(PAYLOAD_KIND.cliBinding, payload);
  return createEntryChannelBinding(CHANNEL.cli, payload);
}

export function overrideCliSegment(segment: {
  readonly token: string;
  readonly aliases?: readonly string[];
  readonly help?: CliGroupHelpInput;
}): ChannelSegmentOverride {
  const payload = {
    token: segment.token,
    aliases: segment.aliases ?? [],
    help: normalizeCliGroupHelp(segment.help),
  } satisfies CliSegment;
  registerChannelPayload(PAYLOAD_KIND.cliSegment, payload);
  return createChannelSegmentOverride(CHANNEL.cli, payload);
}

function normalizeCliArgBinding<Name extends string>(
  input: CliArgBindingInput<Name>,
): CliArgBinding<Name> {
  if (input.kind === CLI_ARG_KIND.option) {
    const binding: CliArgBinding<Name> = {
      kind: input.kind,
      parameterName: input.parameterName,
      flags: input.flags ?? [defaultCliOptionFlag(input.parameterName)],
      valueName: input.valueName ?? defaultCliValueName(input.parameterName),
      coercion: input.coercion ?? null,
      booleanMode: input.booleanMode ?? null,
      negated: input.negated ?? false,
      repeatable: input.repeatMode === CLI_OPTION_VALUE_MODE.commaOrRepeat,
    };
    if (input.valueName !== undefined) {
      registerAuthoredCliValueName(binding);
    }
    return binding;
  }
  return {
    kind: input.kind,
    parameterName: input.parameterName,
    valueName: input.valueName ?? defaultCliValueName(input.parameterName),
    coercion: input.coercion ?? null,
    variadic: input.variadic ?? false,
  };
}

function normalizeCliCommandHelp(
  input: CliCommandHelpInput | undefined,
): CliCommandHelp {
  return {
    usage:
      input?.usages === undefined
        ? { kind: CLI_HELP_USAGE_KIND.derived }
        : { kind: CLI_HELP_USAGE_KIND.authored, values: input.usages },
    examples: normalizeCliHelpExamples(input?.examples),
    optionSections: (input?.optionSections ?? []).map((section) => ({
      heading: section.heading,
      description: section.description ?? null,
      parameterNames: section.parameterNames,
    })),
  };
}

function normalizeCliGroupHelp(
  input: CliGroupHelpInput | undefined,
): CliGroupHelp {
  return {
    subcommandHint: input?.subcommandHint ?? null,
    examples: normalizeCliHelpExamples(input?.examples),
  };
}

function normalizeCliHelpExamples(
  examples: readonly CliHelpExampleInput[] | undefined,
): readonly CliHelpExample[] {
  return (examples ?? []).map((example) => ({
    title: example.title,
    useWhen: example.useWhen,
    command: example.command,
    expectedResult: example.expectedResult ?? [],
  }));
}

type CliHelpOptionBase = {
  readonly parameterName: string;
  readonly flags: readonly CliOptionFlag[];
  readonly description: string;
  readonly requirement: ParameterRequirementDescription;
};

export type CliHelpOption = CliHelpOptionBase &
  (
    | {
        readonly kind: typeof CLI_OPTION_KIND.booleanFlag;
        readonly negativeFlags: readonly CliLongOptionFlag[];
      }
    | {
        readonly kind: typeof CLI_OPTION_KIND.value;
        readonly valueName: string;
        readonly valueMode: CliOptionValueMode;
      }
  );

/**
 * Render-ready option grouping. Unlike `CliHelpOptionSection`, this projected
 * read model contains the referenced options themselves, so renderers never
 * need to join authored parameter names back to the flat option list.
 */
export type CliHelpOptionGroup = {
  /** `null` identifies the unsectioned option group. */
  readonly heading: string | null;
  readonly description: string | null;
  readonly options: readonly CliHelpOption[];
};

export type CliHelpPositional = {
  readonly parameterName: string;
  readonly valueName: string;
  readonly description: string;
  readonly requirement: ParameterRequirementDescription;
  readonly variadic: boolean;
};

export type CliHelpSurface = {
  readonly name: string;
  readonly token: string | null;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly optionGroups: readonly CliHelpOptionGroup[];
  readonly positionals: readonly CliHelpPositional[];
  readonly children: readonly CliHelpSurface[];
  readonly remarks: readonly string[];
  readonly relatedDocs: readonly string[];
  readonly usages: CliHelpUsageList;
  readonly examples: readonly CliHelpExample[];
  readonly subcommandHint: string | null;
};

export type CliHelpRenderContext = {
  /** Full selected command name, including the executable and command path. */
  readonly programName: string;
  /** Root executable name used to prefix authored invocation examples. */
  readonly executableName: string;
  /** Canonical CLI segment-token path for the supplied surface. */
  readonly path: CliCommandPath;
  readonly withDescription: boolean;
};

export type CliHelpRender = (
  surface: CliHelpSurface,
  context: CliHelpRenderContext,
) => string;

export type CliHelpSurfaceLocation = {
  readonly surface: CliHelpSurface;
  readonly path: CliCommandPath;
};

export type CliRouterResult =
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.resolved;
      readonly path: readonly string[];
      readonly endpoint: EntryTreeEndpoint;
      readonly projection: unknown;
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.unknownCommand;
      readonly path: readonly string[];
      readonly token: string;
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.incompleteCommand;
      readonly path: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidInput;
      readonly path: readonly string[];
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidParameter;
      readonly path: readonly string[];
      readonly parameterName: string;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.internalError;
      readonly path: readonly string[];
      readonly error: unknown;
    };

export type CliResolvedEndpointResult<Endpoint extends EntryTreeEndpoint> =
  Omit<
    Extract<
      CliRouterResult,
      { readonly kind: typeof CLI_ROUTER_RESULT_KIND.resolved }
    >,
    "endpoint" | "projection"
  > & {
    readonly endpoint: Endpoint;
    readonly projection: ReturnType<Endpoint["entry"]["project"]>;
  };

export function isCliResolvedEndpoint<const Endpoint extends EntryTreeEndpoint>(
  result: CliRouterResult,
  endpoint: Endpoint,
): result is CliResolvedEndpointResult<Endpoint> {
  return (
    result.kind === CLI_ROUTER_RESULT_KIND.resolved &&
    result.endpoint === endpoint
  );
}

export interface CliRouter {
  readonly help: CliHelpSurface;
  readonly endpoints: readonly EntryTreeEndpoint[];
  resolve(argv: readonly string[]): CliRouterResult;
}
