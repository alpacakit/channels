import {
  CLI_ARG_KIND,
  CLI_VALUE_COERCION,
  type CliArgBinding,
  type CliEntryBinding,
  type CliGroupHelp,
  type CliHelpExample,
  type CliHelpOptionSection,
  type CliHelpUsageList,
  type CliSegment,
  type CliValueCoercion,
} from "./cli-model.js";
import {
  CLI_BOOLEAN_MODE,
  CLI_HELP_USAGE_KIND,
  CLI_OPTION_VALUE_MODE,
} from "./cli-values.js";

const CLI_HELP_USAGE_VALUES_FIELD = "values";

type UnknownFields<Shape> = {
  readonly [Field in keyof Shape]?: unknown;
};

type CliSegmentCandidate = UnknownFields<CliSegment>;
type CliEntryBindingCandidate = UnknownFields<CliEntryBinding>;
type CliCommandHelpCandidate = UnknownFields<CliEntryBinding["help"]>;
type CliHelpUsageCandidate = UnknownFields<
  Extract<
    CliEntryBinding["help"]["usage"],
    { readonly kind: typeof CLI_HELP_USAGE_KIND.authored }
  >
>;
type CliGroupHelpCandidate = UnknownFields<CliGroupHelp>;
type CliHelpExampleCandidate = UnknownFields<CliHelpExample>;
type CliHelpOptionSectionCandidate = UnknownFields<CliHelpOptionSection>;
type CliArgBindingCandidate = UnknownFields<
  Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.option }>
> &
  UnknownFields<
    Extract<CliArgBinding, { readonly kind: typeof CLI_ARG_KIND.positional }>
  >;

export function isCliSegment(value: unknown): value is CliSegment {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliSegmentCandidate;
  return (
    typeof candidate.token === "string" &&
    isStringArray(candidate.aliases) &&
    isCliGroupHelp(candidate.help)
  );
}

export function isCliEntryBinding(value: unknown): value is CliEntryBinding {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliEntryBindingCandidate;
  return (
    Array.isArray(candidate.parameters) &&
    candidate.parameters.every(isCliArgBinding) &&
    isCliCommandHelp(candidate.help)
  );
}

function isCliCommandHelp(value: unknown): value is CliEntryBinding["help"] {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliCommandHelpCandidate;
  return (
    isCliHelpUsage(candidate.usage) &&
    Array.isArray(candidate.examples) &&
    candidate.examples.every(isCliHelpExample) &&
    Array.isArray(candidate.optionSections) &&
    candidate.optionSections.every(isCliHelpOptionSection)
  );
}

function isCliHelpUsage(
  value: unknown,
): value is CliEntryBinding["help"]["usage"] {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliHelpUsageCandidate;
  switch (candidate.kind) {
    case CLI_HELP_USAGE_KIND.derived:
      return !Object.hasOwn(candidate, CLI_HELP_USAGE_VALUES_FIELD);
    case CLI_HELP_USAGE_KIND.authored:
      return isNonEmptyStringArray(candidate.values);
    default:
      return false;
  }
}

function isCliGroupHelp(value: unknown): value is CliGroupHelp {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliGroupHelpCandidate;
  return (
    (candidate.subcommandHint === null ||
      typeof candidate.subcommandHint === "string") &&
    Array.isArray(candidate.examples) &&
    candidate.examples.every(isCliHelpExample)
  );
}

function isCliHelpExample(value: unknown): value is CliHelpExample {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliHelpExampleCandidate;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.useWhen === "string" &&
    typeof candidate.command === "string" &&
    isStringArray(candidate.expectedResult)
  );
}

function isCliHelpOptionSection(value: unknown): value is CliHelpOptionSection {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliHelpOptionSectionCandidate;
  return (
    typeof candidate.heading === "string" &&
    (candidate.description === null ||
      typeof candidate.description === "string") &&
    isStringArray(candidate.parameterNames)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNonEmptyStringArray(value: unknown): value is CliHelpUsageList {
  return isStringArray(value) && value.length > 0;
}

function isCliArgBinding(value: unknown): value is CliArgBinding {
  if (!isUnknownObject(value)) {
    return false;
  }
  const candidate = value as CliArgBindingCandidate;
  if (typeof candidate.parameterName !== "string") {
    return false;
  }
  if (candidate.kind === CLI_ARG_KIND.option) {
    return (
      isOptionalStringArray(candidate.flags) &&
      isOptionalString(candidate.valueName) &&
      isOptionalCliCoercion(candidate.coercion) &&
      isOptionalCliBooleanMode(candidate.booleanMode) &&
      (candidate.negated === undefined || candidate.negated === true) &&
      (candidate.repeatMode === undefined ||
        candidate.repeatMode === CLI_OPTION_VALUE_MODE.commaOrRepeat)
    );
  }
  return (
    candidate.kind === CLI_ARG_KIND.positional &&
    isOptionalString(candidate.valueName) &&
    isOptionalCliCoercion(candidate.coercion) &&
    (candidate.variadic === undefined ||
      typeof candidate.variadic === "boolean")
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(
  value: unknown,
): value is readonly string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isOptionalCliCoercion(
  value: unknown,
): value is CliValueCoercion | undefined {
  return (
    value === undefined ||
    value === CLI_VALUE_COERCION.json ||
    value === CLI_VALUE_COERCION.jsonOrString
  );
}

function isOptionalCliBooleanMode(
  value: unknown,
): value is
  | (typeof CLI_BOOLEAN_MODE)[keyof typeof CLI_BOOLEAN_MODE]
  | undefined {
  return (
    value === undefined ||
    value === CLI_BOOLEAN_MODE.flag ||
    value === CLI_BOOLEAN_MODE.value
  );
}

function isUnknownObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
