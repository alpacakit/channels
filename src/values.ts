export const CHANNEL = {
  cli: "cli",
  mcp: "mcp",
} as const;

export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

export const PARAMETER_REQUIREMENT_KIND = {
  required: "required",
  optional: "optional",
  optionalWithDefault: "optional_with_default",
} as const;

export const VALUE_SHAPE_KIND = {
  string: "string",
  boolean: "boolean",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  array: "array",
} as const;

export const ENTRY_DECODE_RESULT_KIND = {
  resolved: "resolved",
  invalidInput: "invalid_input",
  invalidParameter: "invalid_parameter",
  internalError: "internal_error",
} as const;

export const ENTRY_INPUT_TARGET_KIND = {
  entry: "entry",
  parameter: "parameter",
} as const;

export const ENTRY_OUTPUT_DESCRIPTION_KIND = {
  typed: "typed",
  none: "none",
} as const;
