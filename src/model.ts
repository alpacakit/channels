import type {
  CodecDecodeResult,
  JsonValue,
  RuntimeCodec,
} from "@alpacaloop/core";
import type { z } from "zod";
import {
  type Channel,
  PARAMETER_REQUIREMENT_KIND,
  type VALUE_SHAPE_KIND,
} from "./values.js";

declare const EntryTreeDefinitionBrand: unique symbol;
declare const EntryTreeNodeBrand: unique symbol;
declare const EntryTreeEndpointBrand: unique symbol;
declare const ChannelSegmentOverrideBrand: unique symbol;
declare const EntryChannelBindingBrand: unique symbol;
declare const EntryChannelBindingParameterNames: unique symbol;

export type StringValueShape = {
  readonly kind: typeof VALUE_SHAPE_KIND.string;
};

export type BooleanValueShape = {
  readonly kind: typeof VALUE_SHAPE_KIND.boolean;
};

export type PositiveIntegerValueShape = {
  readonly kind: typeof VALUE_SHAPE_KIND.positiveInteger;
};

export type StringEnumValueShape<
  Values extends readonly string[] = readonly string[],
> = {
  readonly kind: typeof VALUE_SHAPE_KIND.stringEnum;
  readonly values: Values;
};

export type ScalarValueShape =
  | StringValueShape
  | BooleanValueShape
  | PositiveIntegerValueShape
  | StringEnumValueShape;

export type ArrayValueShape<
  Element extends ScalarValueShape = ScalarValueShape,
> = {
  readonly kind: typeof VALUE_SHAPE_KIND.array;
  readonly element: Element;
};

export type ValueShape = ScalarValueShape | ArrayValueShape;

type ScalarJsonValue = string | number | boolean;

type ScalarValueShapeFor<Value extends JsonValue> = [Value] extends [boolean]
  ? BooleanValueShape
  : [Value] extends [number]
    ? PositiveIntegerValueShape
    : [Value] extends [string]
      ? StringValueShape | StringEnumValueShape<readonly Value[]>
      : never;

export type ValueShapeFor<Value extends JsonValue> = [Value] extends [
  ScalarJsonValue,
]
  ? ScalarValueShapeFor<Value>
  : [Value] extends [readonly (infer Element extends JsonValue)[]]
    ? ArrayValueShape<ScalarValueShapeFor<Element>>
    : JsonValue extends Value
      ? ValueShape
      : never;

export type ValueForShape<Shape extends ValueShape> =
  Shape extends BooleanValueShape
    ? boolean
    : Shape extends PositiveIntegerValueShape
      ? number
      : Shape extends StringEnumValueShape<infer Values>
        ? Values[number]
        : Shape extends StringValueShape
          ? string
          : Shape extends ArrayValueShape<infer Element>
            ? readonly ValueForShape<Element>[]
            : never;

export interface ValueCodec<Value extends JsonValue>
  extends RuntimeCodec<Value> {
  readonly schema: z.ZodType<Value>;
  readonly shape: ValueShapeFor<Value>;
}

export type ErasedValueCodec = {
  readonly schema: z.ZodType;
  readonly shape: ValueShape;
  decode(input: unknown): CodecDecodeResult<JsonValue>;
};

export interface OutputContract<Value extends JsonValue> {
  readonly schema: z.ZodType<Value>;
  decode(input: unknown): CodecDecodeResult<Value>;
}

export type RequiredParameterRequirement = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.required;
};

export type OptionalParameterRequirement = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optional;
};

export type OptionalWithDefaultParameterRequirement<Value extends JsonValue> = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optionalWithDefault;
  readonly defaultValue: Value;
};

export type ParameterRequirement<Value extends JsonValue> =
  | RequiredParameterRequirement
  | OptionalParameterRequirement
  | OptionalWithDefaultParameterRequirement<Value>;

export type ParameterDefinition<
  Name extends string,
  Value extends JsonValue,
  Requirement extends ParameterRequirement<Value> = ParameterRequirement<Value>,
> = {
  readonly name: Name;
  readonly codec: ValueCodec<Value>;
  readonly requirement: Requirement;
  readonly description: string;
};

export type ErasedParameterDefinition = {
  readonly name: string;
  readonly codec: ErasedValueCodec;
  readonly requirement: ParameterRequirement<JsonValue>;
  readonly description: string;
};

export type ParameterSet = readonly ErasedParameterDefinition[];

export type RawValueMap = {
  readonly [key: string]: unknown;
};

type ParameterValue<Parameter extends ErasedParameterDefinition> =
  Parameter extends ParameterDefinition<string, infer Value> ? Value : never;

type ParameterMaterialization<Parameter extends ParameterSet[number]> =
  Parameter["requirement"]["kind"] extends
    | typeof PARAMETER_REQUIREMENT_KIND.required
    | typeof PARAMETER_REQUIREMENT_KIND.optionalWithDefault
    ? true
    : false;

type MaterializedParameter<Parameter extends ParameterSet[number]> =
  ParameterMaterialization<Parameter> extends true ? Parameter : never;

type OmittedParameter<Parameter extends ParameterSet[number]> =
  ParameterMaterialization<Parameter> extends false ? Parameter : never;

export type ParameterValues<Parameters extends ParameterSet> = {
  readonly [Parameter in Parameters[number] as MaterializedParameter<Parameter>["name"]]-?: ParameterValue<Parameter>;
} & {
  readonly [Parameter in Parameters[number] as OmittedParameter<Parameter>["name"]]?: ParameterValue<Parameter>;
};

type EntryDefinitionBase<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
> = {
  readonly name: Name;
  readonly parameters: Parameters;
  readonly project: (input: {
    readonly values: ParameterValues<Parameters>;
  }) => Projection;
};

export type EntryDefinitionInput<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
> = EntryDefinitionBase<Name, Parameters, Projection> & {
  readonly output?: OutputContract<Output> | null;
};

export type EntryDefinition<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
> =
  | (EntryDefinitionBase<Name, Parameters, Projection> & {
      readonly output: null;
    })
  | (EntryDefinitionBase<Name, Parameters, Projection> & {
      readonly output: OutputContract<Output>;
    });

export type ErasedOutputContract = {
  readonly schema: z.ZodType;
  decode(input: unknown): CodecDecodeResult<JsonValue>;
};

export type ErasedEntryDefinition =
  | {
      readonly name: string;
      readonly parameters: ParameterSet;
      readonly project: (input: never) => unknown;
      readonly output: null;
    }
  | {
      readonly name: string;
      readonly parameters: ParameterSet;
      readonly project: (input: never) => unknown;
      readonly output: ErasedOutputContract;
    };

export type EntryTreeDefinition = {
  readonly root: EntryTreeNode;
  readonly [EntryTreeDefinitionBrand]: true;
};

export type CommandDocumentation = {
  readonly remarks: readonly string[];
  readonly relatedDocs: readonly string[];
};

export type CommandDocumentationInput = {
  readonly remarks?: readonly string[];
  readonly relatedDocs?: readonly string[];
};

export type EntryTreeNode = {
  readonly name: string;
  readonly description: string;
  readonly documentation: CommandDocumentation;
  readonly segments: readonly ChannelSegmentOverride[];
  readonly endpoints: readonly EntryTreeEndpoint[];
  readonly children: readonly EntryTreeNode[];
  readonly [EntryTreeNodeBrand]: true;
};

export type EntryTreeEndpoint<
  Entry extends ErasedEntryDefinition = ErasedEntryDefinition,
> = {
  readonly entry: Entry;
  readonly channels: readonly EntryChannelBinding[];
  readonly [EntryTreeEndpointBrand]: true;
};

export type ChannelSegmentOverride = {
  readonly channel: Channel;
  readonly segment: unknown;
  readonly [ChannelSegmentOverrideBrand]: true;
};

export type EntryChannelBinding<
  ChannelName extends Channel = Channel,
  ParameterName extends string = string,
> = {
  readonly channel: ChannelName;
  readonly binding: unknown;
  readonly [EntryChannelBindingBrand]: true;
  readonly [EntryChannelBindingParameterNames]: ParameterName;
};

export type EntryDefinitionWithOutput<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
> = Extract<
  EntryDefinition<Name, Parameters, Projection, Output>,
  { readonly output: OutputContract<Output> }
>;

export type EntryDefinitionInputWithOutput<
  Name extends string,
  Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
> = EntryDefinitionInput<Name, Parameters, Projection, Output> & {
  readonly output: OutputContract<Output>;
};

export function defineParameter<
  const Name extends string,
  Value extends JsonValue,
  const Requirement extends ParameterRequirement<Value>,
>(
  parameter: ParameterDefinition<Name, Value, Requirement>,
): ParameterDefinition<Name, Value, Requirement> {
  return parameter;
}

export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
>(
  entry: EntryDefinitionInputWithOutput<Name, Parameters, Projection, Output>,
): EntryDefinitionWithOutput<Name, Parameters, Projection, Output>;
export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
>(
  entry: EntryDefinitionInput<Name, Parameters, Projection, Output>,
): EntryDefinition<Name, Parameters, Projection, Output>;
export function defineEntry<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue = JsonValue,
>(
  entry: EntryDefinitionInput<Name, Parameters, Projection, Output>,
): EntryDefinition<Name, Parameters, Projection, Output> {
  if (entry.output === undefined) {
    return { ...entry, output: null };
  }
  return { ...entry, output: entry.output };
}

export function required(): RequiredParameterRequirement {
  return { kind: PARAMETER_REQUIREMENT_KIND.required };
}

export function optional<
  _Value extends JsonValue,
>(): OptionalParameterRequirement;
export function optional<Value extends JsonValue>(input: {
  readonly default: Value;
}): OptionalWithDefaultParameterRequirement<Value>;
export function optional<Value extends JsonValue>(input?: {
  readonly default: Value;
}):
  | OptionalParameterRequirement
  | OptionalWithDefaultParameterRequirement<Value> {
  if (input === undefined) {
    return { kind: PARAMETER_REQUIREMENT_KIND.optional };
  }
  return {
    kind: PARAMETER_REQUIREMENT_KIND.optionalWithDefault,
    defaultValue: input.default,
  };
}
