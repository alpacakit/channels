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
