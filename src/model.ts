import type {
  CodecDecodeResult,
  JsonValue,
  RuntimeCodec,
} from "@alpacaloop/core";
import type { z } from "zod";

export const PARAMETER_PRESENCE = {
  required: "required",
  optional: "optional",
} as const;

export type ParameterPresence =
  (typeof PARAMETER_PRESENCE)[keyof typeof PARAMETER_PRESENCE];

export const VALUE_SHAPE_KIND = {
  string: "string",
  boolean: "boolean",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  array: "array",
} as const;

export type ValueShape =
  | { readonly kind: typeof VALUE_SHAPE_KIND.string }
  | { readonly kind: typeof VALUE_SHAPE_KIND.boolean }
  | { readonly kind: typeof VALUE_SHAPE_KIND.positiveInteger }
  | {
      readonly kind: typeof VALUE_SHAPE_KIND.stringEnum;
      readonly values: readonly string[];
    }
  | {
      readonly kind: typeof VALUE_SHAPE_KIND.array;
      readonly element: ValueShape;
    };

export interface ValueCodec<Value extends JsonValue>
  extends RuntimeCodec<Value> {
  readonly schema: z.ZodType<Value>;
  readonly shape: ValueShape;
}

export interface OutputContract<Value extends JsonValue> {
  readonly schema: z.ZodType<Value>;
  decode(input: unknown): CodecDecodeResult<Value>;
}

export type ParameterRequirement<Value extends JsonValue> =
  | {
      readonly presence: typeof PARAMETER_PRESENCE.required;
      readonly defaultValue: undefined;
    }
  | {
      readonly presence: typeof PARAMETER_PRESENCE.optional;
      readonly defaultValue: Value | undefined;
    };

export interface ParameterDefinition<
  Name extends string,
  Value extends JsonValue,
> {
  readonly name: Name;
  readonly codec: ValueCodec<Value>;
  readonly requirement: ParameterRequirement<Value>;
  readonly description: string;
}

export type ParameterSet = readonly ParameterDefinition<string, JsonValue>[];

export type RawValueMap = {
  readonly [key: string]: unknown;
};

export type ParameterValues<Parameters extends ParameterSet> = {
  readonly [Parameter in Parameters[number] as Parameter["name"]]?: Parameter extends ParameterDefinition<
    string,
    infer Value
  >
    ? Value
    : never;
};

export interface EntryDefinition<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
> {
  readonly name: Name;
  readonly parameters: Parameters;
  project(input: { readonly values: ParameterValues<Parameters> }): Projection;
  readonly output?: OutputContract<Output>;
}

export type EntryDefinitionWithOutput<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
> = EntryDefinition<Name, Parameters, Projection, Output> & {
  readonly output: OutputContract<Output>;
};

export function defineParameter<
  const Name extends string,
  Value extends JsonValue,
>(
  parameter: ParameterDefinition<Name, Value>,
): ParameterDefinition<Name, Value> {
  return parameter;
}

export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
>(
  entry: EntryDefinitionWithOutput<Name, Parameters, Projection, Output>,
): EntryDefinitionWithOutput<Name, Parameters, Projection, Output>;
export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
>(
  entry: EntryDefinition<Name, Parameters, Projection, Output>,
): EntryDefinition<Name, Parameters, Projection, Output>;
export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
>(
  entry: EntryDefinition<Name, Parameters, Projection, Output>,
): EntryDefinition<Name, Parameters, Projection, Output> {
  return entry;
}

export function required<
  Value extends JsonValue,
>(): ParameterRequirement<Value> {
  return {
    presence: PARAMETER_PRESENCE.required,
    defaultValue: undefined,
  };
}

export function optional<Value extends JsonValue>(
  input: { readonly default?: Value } = {},
): ParameterRequirement<Value> {
  return {
    presence: PARAMETER_PRESENCE.optional,
    defaultValue: input.default,
  };
}

export function projectEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(
  entry: EntryDefinition<Name, Parameters, Projection>,
  values: ParameterValues<Parameters>,
): Projection {
  return entry.project({ values });
}
