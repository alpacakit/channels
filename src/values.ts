export const CHANNEL = {
  cli: "cli",
  http: "http",
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
  json: "json",
} as const;

export const ENTRY_INPUT_TARGET_KIND = {
  entry: "entry",
  parameter: "parameter",
} as const;

export const ENTRY_OUTPUT_DESCRIPTION_KIND = {
  typed: "typed",
  none: "none",
} as const;
