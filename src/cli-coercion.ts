import type { JsonValue } from "@alpacaloop/core";
import type { ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

export function coerceCliArgvValue(
  shape: ValueShape,
  rawValue: unknown,
): JsonValue | undefined {
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
    /^[1-9]\d*$/.test(value)
  ) {
    return Number(value);
  }
  return value as JsonValue;
}
