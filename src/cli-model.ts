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
  RawValueMap,
  ValueShape,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import type { InputPlan, Registration } from "./registration.js";
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
      /**
       * Whether `valueName` was authored rather than derived. Boolean-flag
       * options reject an authored value name at compile time, so the
       * provenance must survive normalization instead of being inferred from
       * the (always-populated) `valueName`.
       */
      readonly valueNameAuthored: boolean;
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
}): EntryChannelBinding<
  typeof CHANNEL.cli,
  CliEntryBinding<Bindings[number]["parameterName"]>
> {
  const payload = ownedRecord({
    parameters: ownedArray(binding.parameters.map(normalizeCliArgBinding)),
    help: normalizeCliCommandHelp(binding.help),
  } satisfies CliEntryBinding);
  registerChannelPayload(PAYLOAD_KIND.cliBinding, payload);
  return createEntryChannelBinding(CHANNEL.cli, payload);
}

export function overrideCliSegment(segment: {
  readonly token: string;
  readonly help?: CliGroupHelpInput;
}): ChannelSegmentOverride<typeof CHANNEL.cli, CliSegment> {
  const payload = ownedRecord({
    token: segment.token,
    help: normalizeCliGroupHelp(segment.help),
  } satisfies CliSegment);
  registerChannelPayload(PAYLOAD_KIND.cliSegment, payload);
  return createChannelSegmentOverride(CHANNEL.cli, payload);
}

function normalizeCliArgBinding<Name extends string>(
  input: CliArgBindingInput<Name>,
): CliArgBinding<Name> {
  if (input.kind === CLI_ARG_KIND.option) {
    return ownedRecord({
      kind: input.kind,
      parameterName: input.parameterName,
      flags: ownedArray(
        input.flags ?? [defaultCliOptionFlag(input.parameterName)],
      ),
      valueName: input.valueName ?? defaultCliValueName(input.parameterName),
      valueNameAuthored: input.valueName !== undefined,
      coercion: input.coercion ?? null,
      booleanMode: input.booleanMode ?? null,
      negated: input.negated ?? false,
      repeatable: input.repeatMode === CLI_OPTION_VALUE_MODE.commaOrRepeat,
    });
  }
  return ownedRecord({
    kind: input.kind,
    parameterName: input.parameterName,
    valueName: input.valueName ?? defaultCliValueName(input.parameterName),
    coercion: input.coercion ?? null,
    variadic: input.variadic ?? false,
  });
}

function normalizeCliCommandHelp(
  input: CliCommandHelpInput | undefined,
): CliCommandHelp {
  return ownedRecord({
    usage:
      input?.usages === undefined
        ? ownedRecord({ kind: CLI_HELP_USAGE_KIND.derived })
        : ownedRecord({
            kind: CLI_HELP_USAGE_KIND.authored,
            values: ownedArray(input.usages),
          }),
    examples: normalizeCliHelpExamples(input?.examples),
    optionSections: ownedArray(
      (input?.optionSections ?? []).map((section) =>
        ownedRecord({
          heading: section.heading,
          description: section.description ?? null,
          parameterNames: ownedArray(section.parameterNames),
        }),
      ),
    ),
  });
}

function normalizeCliGroupHelp(
  input: CliGroupHelpInput | undefined,
): CliGroupHelp {
  return ownedRecord({
    subcommandHint: input?.subcommandHint ?? null,
    examples: normalizeCliHelpExamples(input?.examples),
  });
}

function normalizeCliHelpExamples(
  examples: readonly CliHelpExampleInput[] | undefined,
): readonly CliHelpExample[] {
  return ownedArray(
    (examples ?? []).map((example) =>
      ownedRecord({
        title: example.title,
        useWhen: example.useWhen,
        command: example.command,
        expectedResult: ownedArray(example.expectedResult ?? []),
      }),
    ),
  );
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

type CliParameterBase = {
  readonly parameterName: string;
  readonly description: string;
  readonly requirement: ParameterRequirementDescription;
  readonly shape: ValueShape;
  readonly coercion: CliValueCoercion | null;
};

export type CliParameterView =
  | (CliParameterBase & {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly optionKind: typeof CLI_OPTION_KIND.booleanFlag;
      readonly flags: readonly CliOptionFlag[];
      readonly negativeFlags: readonly CliLongOptionFlag[];
      readonly valueName: null;
      readonly valueMode: null;
    })
  | (CliParameterBase & {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly optionKind: typeof CLI_OPTION_KIND.value;
      readonly flags: readonly CliOptionFlag[];
      readonly negativeFlags: readonly [];
      readonly valueName: string;
      readonly valueMode: CliOptionValueMode;
    })
  | (CliParameterBase & {
      readonly kind: typeof CLI_ARG_KIND.positional;
      readonly valueName: string;
      readonly variadic: boolean;
    });

export type CliInputPlan<Values extends RawValueMap, Input> = InputPlan<
  Values,
  Input
> & {
  readonly parseOptions: (raw: RawValueMap) => Input;
};

export type CliRegistration<
  Values extends RawValueMap,
  Input,
  Context,
  Output,
> = Omit<
  Registration<Values, Input, Context, Output>,
  "binding" | "input" | "parameters"
> & {
  readonly path: CliCommandPath;
  readonly binding: EntryChannelBinding<typeof CHANNEL.cli, CliEntryBinding>;
  readonly parameters: readonly CliParameterView[];
  readonly input: CliInputPlan<Values, Input>;
};

export interface CliRegistrationCollection<Context, Output> {
  readonly length: number;
  readonly forEach: (
    visit: <Values extends RawValueMap, Input>(
      item: CliRegistration<Values, Input, Context, Output>,
    ) => void,
  ) => void;
}

export type CliCommandNode<Context, Output> = {
  readonly token: string;
  readonly path: CliCommandPath;
  readonly description: string;
  readonly documentation: import("./model.js").CommandDocumentation;
  readonly help: CliHelpSurface;
  readonly commands: CliRegistrationCollection<Context, Output>;
  readonly children: readonly CliCommandNode<Context, Output>[];
};

export type CliCommandTree<Context, Output> = {
  readonly root: CliCommandNode<Context, Output>;
};
