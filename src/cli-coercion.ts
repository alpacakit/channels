import type { JsonValue } from "@alpacaloop/core";
import type { ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

export function coerceCliValue(
  shape: ValueShape,
  rawValue: unknown,
): JsonValue | undefined {
  return coerceCliValueWith(shape, rawValue, coerceLegacyCliScalarValue);
}

export function coerceCliArgvValue(
  shape: ValueShape,
  rawValue: unknown,
): JsonValue | undefined {
  return coerceCliValueWith(shape, rawValue, coerceCliArgvScalarValue);
}

type CliScalarCoercer = (shape: ValueShape, value: unknown) => JsonValue;

function coerceCliValueWith(
  shape: ValueShape,
  rawValue: unknown,
  coerceScalar: CliScalarCoercer,
): JsonValue | undefined {
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    return values.map((value) => coerceScalar(shape.element, value));
  }
  return coerceScalar(shape, rawValue);
}

function coerceLegacyCliScalarValue(
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
  return value as JsonValue;
}

function coerceCliArgvScalarValue(
  shape: ValueShape,
  value: unknown,
): JsonValue {
  const legacyValue = coerceLegacyCliScalarValue(shape, value);
  if (
    shape.kind === VALUE_SHAPE_KIND.positiveInteger &&
    typeof legacyValue === "string" &&
    /^[1-9]\d*$/.test(legacyValue)
  ) {
    return Number(legacyValue);
  }
  return legacyValue;
}
