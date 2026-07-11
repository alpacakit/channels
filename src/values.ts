export const CHANNEL = {
  cli: "cli",
  http: "http",
  mcp: "mcp",
} as const;

export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

export const PARAMETER_PRESENCE = {
  required: "required",
  optional: "optional",
} as const;

export type ParameterPresence =
  (typeof PARAMETER_PRESENCE)[keyof typeof PARAMETER_PRESENCE];

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
  internalError: "internal_error",
} as const;
