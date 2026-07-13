import type { JsonValue } from "@alpacaloop/core";
import { CLI_VALUE_COERCION, type CliValueCoercion } from "./cli-model.js";
import type { ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

export function coerceCliArgvValue(
  shape: ValueShape,
  rawValue: unknown,
  coercion: CliValueCoercion | null,
): JsonValue | undefined {
  if (coercion !== null) {
    return coerceExplicitCliValue(rawValue, coercion);
  }
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    return values.map((value) =>
      coerceCliArgvScalarValue(shape.element, value),
    );
  }
  return coerceCliArgvScalarValue(shape, rawValue);
}

function coerceCliArgvScalarValue(
  shape: ValueShape,
  value: unknown,
): JsonValue {
  if (shape.kind === VALUE_SHAPE_KIND.boolean) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  if (
    shape.kind === VALUE_SHAPE_KIND.positiveInteger &&
    typeof value === "string" &&
    /^[+-]?\d+$/.test(value)
  ) {
    return Number(value);
  }
  return value as JsonValue;
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
