const CLI_PARAMETER_SYNTAX = {
  longOptionPrefix: "--",
  parameterWordSeparator: "-",
  valueWordSeparator: "_",
} as const;

export const CLI_BOOLEAN_MODE = {
  flag: "flag",
  value: "value",
} as const;

export const CLI_HELP_USAGE_KIND = {
  authored: "authored",
  derived: "derived",
} as const;

export const CLI_OPTION_KIND = {
  booleanFlag: "boolean_flag",
  value: "value",
} as const;

export const CLI_OPTION_VALUE_MODE = {
  replace: "replace",
  repeat: "repeat",
  commaOrRepeat: "comma_or_repeat",
} as const;

export const CLI_POSITIONAL_PLAN_KIND = {
  single: "single",
  rest: "rest",
} as const;

export function defaultCliOptionFlag(parameterName: string): `--${string}` {
  return `${CLI_PARAMETER_SYNTAX.longOptionPrefix}${toKebabCase(parameterName)}`;
}

export function defaultCliValueName(parameterName: string): string {
  return toKebabCase(parameterName)
    .replace(/-/g, CLI_PARAMETER_SYNTAX.valueWordSeparator)
    .toUpperCase();
}

function toKebabCase(name: string): string {
  return name
    .replace(
      /[A-Z]/g,
      (letter) =>
        `${CLI_PARAMETER_SYNTAX.parameterWordSeparator}${letter.toLowerCase()}`,
    )
    .replace(/_/g, CLI_PARAMETER_SYNTAX.parameterWordSeparator)
    .replace(/^-/, "");
}
