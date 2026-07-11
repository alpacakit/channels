import {
  createSchemaRuntimeCodec,
  type JsonValue,
  readonlyArraySchema,
} from "@alpacaloop/core";
import { z } from "zod";
import type { ValueCodec, ValueShape } from "./model.js";
import { VALUE_SHAPE_KIND } from "./values.js";

function defineValueCodec<Value extends JsonValue>(input: {
  readonly schema: z.ZodType<Value>;
  readonly shape: ValueShape;
}): ValueCodec<Value> {
  const codec = createSchemaRuntimeCodec(input.schema);
  return {
    schema: input.schema,
    shape: input.shape,
    decode: codec.decode,
    encode: codec.encode,
  };
}

function stringCodec(): ValueCodec<string> {
  return defineValueCodec({
    schema: z.string(),
    shape: { kind: VALUE_SHAPE_KIND.string },
  });
}

function booleanCodec(): ValueCodec<boolean> {
  return defineValueCodec({
    schema: z.boolean(),
    shape: { kind: VALUE_SHAPE_KIND.boolean },
  });
}

function positiveIntegerCodec(
  input: { readonly max: number | null } = { max: null },
): ValueCodec<number> {
  const base = z.number().int().positive();
  return defineValueCodec({
    schema: (input.max === null
      ? base
      : base.max(input.max)) as z.ZodType<number>,
    shape: { kind: VALUE_SHAPE_KIND.positiveInteger },
  });
}

function stringEnumCodec<const Values extends readonly [string, ...string[]]>(
  values: Values,
): ValueCodec<Values[number]> {
  return defineValueCodec({
    schema: z.enum(values) as z.ZodType<Values[number]>,
    shape: {
      kind: VALUE_SHAPE_KIND.stringEnum,
      values,
    },
  });
}

function stringEnumListCodec<
  const Values extends readonly [string, ...string[]],
>(values: Values): ValueCodec<readonly Values[number][]> {
  const element = stringEnumCodec(values);
  return defineValueCodec({
    schema: readonlyArraySchema(element.schema),
    shape: {
      kind: VALUE_SHAPE_KIND.array,
      element: element.shape,
    },
  });
}

function stringListCodec(): ValueCodec<readonly string[]> {
  const element = stringCodec();
  return defineValueCodec({
    schema: readonlyArraySchema(element.schema),
    shape: {
      kind: VALUE_SHAPE_KIND.array,
      element: element.shape,
    },
  });
}

export const codecs = {
  define: defineValueCodec,
  string: stringCodec,
  stringList: stringListCodec,
  boolean: booleanCodec,
  positiveInteger: positiveIntegerCodec,
  stringEnum: stringEnumCodec,
  stringEnumList: stringEnumListCodec,
};
