import { z } from "zod";
import type { DecodedJsonValue, JsonValue } from "./json.js";
import type {
  JsonValueShape,
  ValueCodec,
  ValueShape,
  ValueShapeFor,
} from "./model.js";
import { ownedArray, ownedRecord, snapshotValueShape } from "./owned.js";
import { VALUE_SHAPE_KIND } from "./values.js";

type JsonInput<Raw> = Raw extends JsonValue ? Raw : JsonValue;

function defineValueCodec<Raw, Value extends JsonValue>(input: {
  readonly schema: z.ZodType<Value, Raw>;
  readonly shape: ValueShapeFor<JsonInput<Raw>>;
}): ValueCodec<Raw, Value> {
  return makeValueCodec(input.schema, input.shape);
}

function makeValueCodec<
  Raw,
  Value extends DecodedJsonValue,
  Shape extends ValueShape = ValueShapeFor<JsonInput<Raw>>,
>(schema: z.ZodType<Value, Raw>, shape: Shape): ValueCodec<Raw, Value, Shape> {
  return ownedRecord({
    schema,
    shape: snapshotValueShape(shape),
  });
}

function jsonCodec<Raw, Value extends DecodedJsonValue>(
  schema: z.ZodType<Value, Raw>,
): ValueCodec<Raw, Value, JsonValueShape> {
  return makeValueCodec(schema, {
    kind: VALUE_SHAPE_KIND.json,
  });
}

function stringCodec(): ValueCodec<string, string> {
  return defineValueCodec({
    schema: z.string(),
    shape: { kind: VALUE_SHAPE_KIND.string },
  });
}

function booleanCodec(): ValueCodec<boolean, boolean> {
  return defineValueCodec({
    schema: z.boolean(),
    shape: { kind: VALUE_SHAPE_KIND.boolean },
  });
}

function positiveIntegerCodec(
  input: { readonly max: number | null } = { max: null },
): ValueCodec<number, number> {
  const base = z.number().int().positive();
  return defineValueCodec({
    schema: input.max === null ? base : base.max(input.max),
    shape: { kind: VALUE_SHAPE_KIND.positiveInteger },
  });
}

function stringEnumCodec<const Values extends readonly [string, ...string[]]>(
  values: Values,
): ValueCodec<Values[number], Values[number]> {
  const snapshot = ownedArray(values);
  return makeValueCodec<Values[number], Values[number]>(z.enum(snapshot), {
    kind: VALUE_SHAPE_KIND.stringEnum,
    values: snapshot,
  } as unknown as ValueShapeFor<JsonInput<Values[number]>>);
}

function stringEnumListCodec<
  const Values extends readonly [string, ...string[]],
>(
  values: Values,
): ValueCodec<readonly Values[number][], readonly Values[number][]> {
  const element = stringEnumCodec(values);
  return makeValueCodec<readonly Values[number][], readonly Values[number][]>(
    z.array(element.schema).readonly(),
    {
      kind: VALUE_SHAPE_KIND.array,
      element: {
        kind: VALUE_SHAPE_KIND.stringEnum,
        values,
      },
    } as unknown as ValueShapeFor<JsonInput<readonly Values[number][]>>,
  );
}

function stringListCodec(): ValueCodec<readonly string[], readonly string[]> {
  const element = stringCodec();
  return makeValueCodec<readonly string[], readonly string[]>(
    z.array(element.schema).readonly(),
    {
      kind: VALUE_SHAPE_KIND.array,
      element: element.shape,
    },
  );
}

export const codecs = {
  define: defineValueCodec,
  json: jsonCodec,
  string: stringCodec,
  stringList: stringListCodec,
  boolean: booleanCodec,
  positiveInteger: positiveIntegerCodec,
  stringEnum: stringEnumCodec,
  stringEnumList: stringEnumListCodec,
} as const;
