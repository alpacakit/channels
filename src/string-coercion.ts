import type { JsonValue } from "@alpacakit/core";
import type { ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

export function coerceStringValue(
  shape: ValueShape,
  rawValue: unknown,
): JsonValue {
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    return values.map((value) => coerceStringScalarValue(shape.element, value));
  }
  return coerceStringScalarValue(shape, rawValue);
}

function coerceStringScalarValue(shape: ValueShape, value: unknown): JsonValue {
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
