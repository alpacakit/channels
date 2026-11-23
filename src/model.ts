import type { z } from "zod";
import { EntryTreeDefinitionError } from "./definition-error.js";
import type { JsonValue } from "./json.js";
import {
  ownedArray,
  ownedRecord,
  snapshotJsonValue,
  snapshotValueShape,
} from "./owned.js";
import {
  type Channel,
  PARAMETER_REQUIREMENT_KIND,
  type VALUE_SHAPE_KIND,
} from "./values.js";

declare const EntryTreeDefinitionBrand: unique symbol;
declare const EntryTreeNodeBrand: unique symbol;
declare const EntryTreeNodeEndpoints: unique symbol;
declare const EntryTreeEndpointBrand: unique symbol;
declare const ChannelSegmentOverrideBrand: unique symbol;
declare const EntryChannelBindingBrand: unique symbol;

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

export type JsonValueShape = {
  readonly kind: typeof VALUE_SHAPE_KIND.json;
};

export type ValueShape = ScalarValueShape | ArrayValueShape | JsonValueShape;

type ScalarJsonValue = string | number | boolean;

type ScalarValueShapeFor<Value extends JsonValue> = [Value] extends [boolean]
  ? BooleanValueShape
  : [Value] extends [number]
    ? PositiveIntegerValueShape
    : [Value] extends [string]
      ? StringValueShape | StringEnumValueShape<readonly Value[]>
      : never;

export type ValueShapeFor<Raw extends JsonValue> =
  | JsonValueShape
  | StringCoercibleValueShapeFor<Raw>;

type StringCoercibleValueShapeFor<Raw extends JsonValue> = [Raw] extends [
  ScalarJsonValue,
]
  ? ScalarValueShapeFor<Raw>
  : [Raw] extends [readonly (infer Element extends JsonValue)[]]
    ? [Element] extends [ScalarJsonValue]
      ? ArrayValueShape<ScalarValueShapeFor<Element>>
      : StringValueShape
    : ScalarValueShape | ArrayValueShape;

/** A schema input (`Raw`) and its decoded output (`Value`) are distinct. */
type JsonInput<Raw> = Raw extends JsonValue ? Raw : JsonValue;

export interface ValueCodec<
  Raw = JsonValue,
  Value extends JsonValue = JsonValue,
> {
  readonly schema: z.ZodType<Value, Raw>;
  readonly shape: ValueShapeFor<JsonInput<Raw>>;
}

export type ErasedValueCodec = {
  readonly schema: z.ZodType;
  readonly shape: ValueShape;
};

export interface OutputContract<Value extends JsonValue> {
  readonly schema: z.ZodType<Value>;
}

export type RequiredParameterRequirement = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.required;
};

export type OptionalParameterRequirement = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optional;
};

export type OptionalWithDefaultParameterRequirement<Raw extends JsonValue> = {
  readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optionalWithDefault;
  readonly defaultValue: Raw;
};

export type ParameterRequirement<Raw extends JsonValue> =
  | RequiredParameterRequirement
  | OptionalParameterRequirement
  | OptionalWithDefaultParameterRequirement<Raw>;

export type ParameterDefinition<
  Name extends string,
  Raw,
  Value extends JsonValue,
  Requirement extends ParameterRequirement<
    JsonInput<Raw>
  > = ParameterRequirement<JsonInput<Raw>>,
> = {
  readonly name: Name;
  readonly codec: ValueCodec<Raw, Value>;
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
  Parameter["codec"] extends ValueCodec<infer _Raw, infer Value>
    ? Value
    : never;

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
  readonly output?: OutputContract<Output>;
};

export type EntryDefinition<
  Name extends string = string,
  Parameters extends ParameterSet = ParameterSet,
  Projection = unknown,
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

export type Callable = (...args: never[]) => unknown;

export type EntryChannelBinding<
  ChannelName extends Channel = Channel,
  Binding = unknown,
> = {
  readonly channel: ChannelName;
  readonly binding: Binding;
  readonly [EntryChannelBindingBrand]: true;
};

export type ChannelSegmentOverride<
  ChannelName extends Channel = Channel,
  Segment = unknown,
> = {
  readonly channel: ChannelName;
  readonly segment: Segment;
  readonly [ChannelSegmentOverrideBrand]: true;
};

export type EntryTreeEndpoint<
  Entry extends ErasedEntryDefinition = ErasedEntryDefinition,
  Handler extends Callable = Callable,
  Channels extends
    readonly EntryChannelBinding[] = readonly EntryChannelBinding[],
> = {
  readonly entry: Entry;
  readonly handler: Handler;
  readonly channels: Channels;
  readonly [EntryTreeEndpointBrand]: true;
};

export type CommandDocumentation = {
  readonly remarks: readonly string[];
  readonly relatedDocs: readonly string[];
};

export type CommandDocumentationInput = {
  readonly remarks?: readonly string[];
  readonly relatedDocs?: readonly string[];
};

export type EntryTreeNode<
  Endpoints extends EntryTreeEndpoint = EntryTreeEndpoint,
> = {
  readonly name: string;
  readonly description: string;
  readonly documentation: CommandDocumentation;
  readonly segments: readonly ChannelSegmentOverride[];
  readonly endpoints: readonly EntryTreeEndpoint[];
  readonly children: readonly EntryTreeNode[];
  readonly [EntryTreeNodeEndpoints]: Endpoints;
  readonly [EntryTreeNodeBrand]: true;
};

export type EntryTreeDefinition<
  Endpoints extends EntryTreeEndpoint = EntryTreeEndpoint,
> = {
  readonly root: EntryTreeNode<Endpoints>;
  readonly [EntryTreeDefinitionBrand]: true;
};

export type EndpointsOfNode<Node extends EntryTreeNode> =
  Node extends EntryTreeNode<infer Endpoints> ? Endpoints : never;

export type EndpointsOfTree<Tree extends EntryTreeDefinition> =
  Tree extends EntryTreeDefinition<infer Endpoints> ? Endpoints : never;

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
  Raw,
  Value extends JsonValue,
  const Requirement extends ParameterRequirement<JsonInput<Raw>>,
>(
  parameter: ParameterDefinition<Name, Raw, Value, Requirement>,
): ParameterDefinition<Name, Raw, Value, Requirement> {
  return snapshotParameter(parameter);
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
  const parameters = ownedArray(
    entry.parameters.map((parameter) => snapshotParameter(parameter)),
  ) as unknown as Parameters;
  const names = new Set<string>();
  const issues: string[] = [];
  for (const parameter of parameters) {
    if (names.has(parameter.name)) {
      issues.push(
        `${entry.name}: duplicate parameter name ${JSON.stringify(parameter.name)}`,
      );
    }
    names.add(parameter.name);
  }
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  const output =
    entry.output === undefined
      ? null
      : ownedRecord({ schema: entry.output.schema });
  return ownedRecord({ ...entry, parameters, output }) as EntryDefinition<
    Name,
    Parameters,
    Projection,
    Output
  >;
}

export function required(): RequiredParameterRequirement {
  return ownedRecord({ kind: PARAMETER_REQUIREMENT_KIND.required });
}

export function optional<
  _Raw extends JsonValue,
>(): OptionalParameterRequirement;
export function optional<const Raw extends JsonValue>(input: {
  readonly default: Raw;
}): OptionalWithDefaultParameterRequirement<Raw>;
export function optional<Raw extends JsonValue>(input?: {
  readonly default: Raw;
}):
  | OptionalParameterRequirement
  | OptionalWithDefaultParameterRequirement<Raw> {
  if (input === undefined) {
    return ownedRecord({ kind: PARAMETER_REQUIREMENT_KIND.optional });
  }
  return ownedRecord({
    kind: PARAMETER_REQUIREMENT_KIND.optionalWithDefault,
    defaultValue: snapshotJsonValue(input.default),
  });
}

function snapshotParameter<
  const Name extends string,
  Raw,
  Value extends JsonValue,
  const Requirement extends ParameterRequirement<JsonInput<Raw>>,
>(
  parameter: ParameterDefinition<Name, Raw, Value, Requirement>,
): ParameterDefinition<Name, Raw, Value, Requirement>;
function snapshotParameter(
  parameter: ErasedParameterDefinition,
): ErasedParameterDefinition;
function snapshotParameter(
  parameter: ErasedParameterDefinition,
): ErasedParameterDefinition {
  if (parameter.name.length === 0) {
    throw new EntryTreeDefinitionError(["parameter name must not be empty"]);
  }
  const requirement =
    parameter.requirement.kind ===
    PARAMETER_REQUIREMENT_KIND.optionalWithDefault
      ? ownedRecord({
          kind: parameter.requirement.kind,
          defaultValue: snapshotJsonValue(parameter.requirement.defaultValue),
        })
      : ownedRecord({ kind: parameter.requirement.kind });
  return ownedRecord({
    name: parameter.name,
    codec: ownedRecord({
      schema: parameter.codec.schema,
      shape: snapshotValueShape(parameter.codec.shape),
    }),
    requirement,
    description: parameter.description,
  });
}
