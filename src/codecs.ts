import {
  createSchemaRuntimeCodec,
  readonlyArraySchema,
  type JsonValue,
} from "@alpacaloop/core";
import { z } from "zod";
import {
  CHANNEL_VALUE_SHAPE_KIND,
  type ChannelValueCodec,
  type ChannelValueShape,
} from "./model.js";

export function defineChannelValueCodec<Value extends JsonValue>(input: {
  readonly schema: z.ZodType<Value>;
  readonly shape: ChannelValueShape;
}): ChannelValueCodec<Value> {
  const codec = createSchemaRuntimeCodec(input.schema);
  return {
    schema: input.schema,
    shape: input.shape,
    decode: codec.decode,
    encode: codec.encode,
  };
}

export function stringChannelValueCodec(): ChannelValueCodec<string> {
  return defineChannelValueCodec({
    schema: z.string(),
    shape: { kind: CHANNEL_VALUE_SHAPE_KIND.string },
  });
}

export function booleanChannelValueCodec(): ChannelValueCodec<boolean> {
  return defineChannelValueCodec({
    schema: z.boolean(),
    shape: { kind: CHANNEL_VALUE_SHAPE_KIND.boolean },
  });
}

export function positiveIntegerChannelValueCodec(
  input: { readonly max: number | null } = { max: null },
): ChannelValueCodec<number> {
  const base = z.number().int().positive();
  return defineChannelValueCodec({
    schema: (input.max === null
      ? base
      : base.max(input.max)) as z.ZodType<number>,
    shape: { kind: CHANNEL_VALUE_SHAPE_KIND.positiveInteger },
  });
}

export function stringEnumChannelValueCodec<
  const Values extends readonly [string, ...string[]],
>(values: Values): ChannelValueCodec<Values[number]> {
  return defineChannelValueCodec({
    schema: z.enum(values) as z.ZodType<Values[number]>,
    shape: {
      kind: CHANNEL_VALUE_SHAPE_KIND.stringEnum,
      values,
    },
  });
}

export function stringEnumListChannelValueCodec<
  const Values extends readonly [string, ...string[]],
>(values: Values): ChannelValueCodec<readonly Values[number][]> {
  const element = stringEnumChannelValueCodec(values);
  return defineChannelValueCodec({
    schema: readonlyArraySchema(element.schema),
    shape: {
      kind: CHANNEL_VALUE_SHAPE_KIND.array,
      element: element.shape,
    },
  });
}

export function stringListChannelValueCodec(): ChannelValueCodec<
  readonly string[]
> {
  const element = stringChannelValueCodec();
  return defineChannelValueCodec({
    schema: readonlyArraySchema(element.schema),
    shape: {
      kind: CHANNEL_VALUE_SHAPE_KIND.array,
      element: element.shape,
    },
  });
}
