import { CLI_VALUE_COERCION, type CliValueCoercion } from "./cli-model.js";
import type { JsonValue } from "./json.js";
import type { ValueShape } from "./model.js";
import { EntryInputError } from "./runtime.js";
import { coerceStringValue } from "./string-coercion.js";
import { ENTRY_INPUT_TARGET_KIND } from "./values.js";

export function coerceCliArgvValue(
  parameterName: string,
  shape: ValueShape,
  rawValue: unknown,
  coercion: CliValueCoercion | null,
): JsonValue | undefined {
  if (coercion !== null) {
    return coerceExplicitCliValue(parameterName, rawValue, coercion);
  }
  return coerceStringValue(shape, rawValue);
}

function coerceExplicitCliValue(
  parameterName: string,
  rawValue: unknown,
  coercion: CliValueCoercion,
): JsonValue | undefined {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) =>
      coerceExplicitCliScalar(parameterName, value, coercion),
    );
  }
  return coerceExplicitCliScalar(parameterName, rawValue, coercion);
}

function coerceExplicitCliScalar(
  parameterName: string,
  value: unknown,
  coercion: CliValueCoercion,
): JsonValue {
  if (typeof value !== "string") {
    return value as JsonValue;
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    if (coercion === CLI_VALUE_COERCION.jsonOrString) {
      return value;
    }
    throw new EntryInputError([`Invalid JSON value: ${errorMessage(error)}`], {
      kind: ENTRY_INPUT_TARGET_KIND.parameter,
      parameterName,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
