import type { JsonValue } from "@alpacakit/core";
import { CLI_VALUE_COERCION, type CliValueCoercion } from "./cli-model.js";
import type { ValueShape } from "./model.js";
import { coerceStringValue } from "./string-coercion.js";

export function coerceCliArgvValue(
  shape: ValueShape,
  rawValue: unknown,
  coercion: CliValueCoercion | null,
): JsonValue | undefined {
  if (coercion !== null) {
    return coerceExplicitCliValue(rawValue, coercion);
  }
  return coerceStringValue(shape, rawValue);
}

function coerceExplicitCliValue(
  rawValue: unknown,
  coercion: CliValueCoercion,
): JsonValue | undefined {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => coerceExplicitCliScalar(value, coercion));
  }
  return coerceExplicitCliScalar(rawValue, coercion);
}

function coerceExplicitCliScalar(
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
    throw new Error(`Invalid JSON value: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
