import type { JsonValue, RuntimeCodec } from "@alpacaloop/core";
import type { z } from "zod";

export const CHANNEL_PARAMETER_PRESENCE = {
  required: "required",
  optional: "optional",
} as const;

export type ChannelParameterPresence =
  (typeof CHANNEL_PARAMETER_PRESENCE)[keyof typeof CHANNEL_PARAMETER_PRESENCE];

export const CHANNEL_VALUE_SHAPE_KIND = {
  string: "string",
  boolean: "boolean",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  array: "array",
} as const;

export type ChannelValueShape =
  | { readonly kind: typeof CHANNEL_VALUE_SHAPE_KIND.string }
  | { readonly kind: typeof CHANNEL_VALUE_SHAPE_KIND.boolean }
  | { readonly kind: typeof CHANNEL_VALUE_SHAPE_KIND.positiveInteger }
  | {
      readonly kind: typeof CHANNEL_VALUE_SHAPE_KIND.stringEnum;
      readonly values: readonly string[];
    }
  | {
      readonly kind: typeof CHANNEL_VALUE_SHAPE_KIND.array;
      readonly element: ChannelValueShape;
    };

export interface ChannelValueCodec<Value extends JsonValue>
  extends RuntimeCodec<Value> {
  readonly schema: z.ZodType<Value>;
  readonly shape: ChannelValueShape;
}

export type ChannelParameterRequirement<Value extends JsonValue> =
  | {
      readonly presence: typeof CHANNEL_PARAMETER_PRESENCE.required;
      readonly defaultValue: undefined;
    }
  | {
      readonly presence: typeof CHANNEL_PARAMETER_PRESENCE.optional;
      readonly defaultValue: Value | undefined;
    };

export interface ChannelParameterDefinition<
  Name extends string,
  Value extends JsonValue,
> {
  readonly name: Name;
  readonly codec: ChannelValueCodec<Value>;
  readonly requirement: ChannelParameterRequirement<Value>;
  readonly description: string;
}

export type ChannelParameterSet = readonly ChannelParameterDefinition<
  string,
  JsonValue
>[];

export type ChannelRawValueMap = {
  readonly [key: string]: unknown;
};

export type ChannelParameterValues<Parameters extends ChannelParameterSet> = {
  readonly [Parameter in Parameters[number] as Parameter["name"]]?: Parameter extends ChannelParameterDefinition<
    string,
    infer Value
  >
    ? Value
    : never;
};

export interface ChannelEntryDefinition<
  Name extends string,
  Parameters extends ChannelParameterSet,
  Projection,
> {
  readonly name: Name;
  readonly parameters: Parameters;
  project(input: {
    readonly values: ChannelParameterValues<Parameters>;
  }): Projection;
}

export function defineChannelParameter<
  const Name extends string,
  Value extends JsonValue,
>(
  parameter: ChannelParameterDefinition<Name, Value>,
): ChannelParameterDefinition<Name, Value> {
  return parameter;
}

export function defineChannelEntry<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(
  entry: ChannelEntryDefinition<Name, Parameters, Projection>,
): ChannelEntryDefinition<Name, Parameters, Projection> {
  return entry;
}

export function requiredChannelParameter<
  Value extends JsonValue,
>(): ChannelParameterRequirement<Value> {
  return {
    presence: CHANNEL_PARAMETER_PRESENCE.required,
    defaultValue: undefined,
  };
}

export function optionalChannelParameter<Value extends JsonValue>(
  defaultValue?: Value,
): ChannelParameterRequirement<Value> {
  return {
    presence: CHANNEL_PARAMETER_PRESENCE.optional,
    defaultValue,
  };
}

export function projectChannelEntry<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(
  entry: ChannelEntryDefinition<Name, Parameters, Projection>,
  values: ChannelParameterValues<Parameters>,
): Projection {
  return entry.project({ values });
}

export function findChannelParameter<
  const Parameters extends ChannelParameterSet,
>(parameters: Parameters, name: string): Parameters[number] | null {
  return parameters.find((parameter) => parameter.name === name) ?? null;
}

export function requireChannelParameter<
  const Parameters extends ChannelParameterSet,
>(parameters: Parameters, name: string): Parameters[number] {
  const parameter = findChannelParameter(parameters, name);
  if (parameter === null) {
    throw new Error(`Unknown channel parameter binding: ${name}`);
  }
  return parameter;
}
