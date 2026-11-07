import type { JsonValue } from "./json.js";
import type { ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

/** Copies and freezes an array whose contents are already owned snapshots. */
export function ownedArray<const Values extends readonly unknown[]>(
  values: Values,
): Values {
  return Object.freeze([...values]) as unknown as Values;
}

/** Freezes one library-created record after all of its fields are prepared. */
export function ownedRecord<Value extends object>(value: Value): Value {
  return Object.freeze(value);
}

/** Copies and freezes JSON data without traversing schemas or user functions. */
export function snapshotJsonValue<const Value extends JsonValue>(
  value: Value,
): Value {
  return copyJson(value, new Set(), true) as Value;
}

/** Copies stored JSON into an invocation-owned mutable input value. */
export function copyJsonValue<const Value extends JsonValue>(
  value: Value,
): Value {
  return copyJson(value, new Set(), false) as Value;
}

export function snapshotValueShape<const Shape extends ValueShape>(
  shape: Shape,
): Shape {
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    return ownedRecord({
      kind: shape.kind,
      element: snapshotValueShape(shape.element),
    }) as Shape;
  }
  if (shape.kind === VALUE_SHAPE_KIND.stringEnum) {
    return ownedRecord({
      kind: shape.kind,
      values: ownedArray(shape.values),
    }) as Shape;
  }
  return ownedRecord({ kind: shape.kind }) as Shape;
}

function copyJson(
  value: JsonValue,
  ancestors: Set<object>,
  freeze: boolean,
): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (ancestors.has(value)) {
    throw new TypeError("JSON values must not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.map((item) => copyJson(item, ancestors, freeze));
      return freeze ? Object.freeze(result) : result;
    }
    const record = value as Readonly<Record<string, JsonValue>>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(record)) {
      Object.defineProperty(result, key, {
        configurable: !freeze,
        enumerable: true,
        value: copyJson(record[key] as JsonValue, ancestors, freeze),
        writable: !freeze,
      });
    }
    return freeze ? Object.freeze(result) : result;
  } finally {
    ancestors.delete(value);
  }
}
