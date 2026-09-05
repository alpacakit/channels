import type { z } from "zod";
import type { ParameterDescription } from "./introspection.js";
import type {
  Callable,
  EndpointsOfNode,
  EndpointsOfTree,
  EntryChannelBinding,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ErasedEntryDefinition,
  RawValueMap,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import type { Channel } from "./values.js";

export type ContextOf<Handler extends Callable> =
  number extends Parameters<Handler>["length"]
    ? never
    : 2 extends Parameters<Handler>["length"]
      ? Parameters<Handler>[1]
      : unknown;

export type CollectionContext<Handler extends Callable> = [Handler] extends [
  never,
]
  ? unknown
  : (
        Handler extends Callable
          ? (context: ContextOf<Handler>) => void
          : never
      ) extends (context: infer Context) => void
    ? Context
    : never;

export type ContextArgs<Context> = undefined extends Context
  ? [context?: Context]
  : [context: Context];

export type HandlerView<Input, Context, Output> = (
  input: Input,
  ...context: ContextArgs<Context>
) => Output | PromiseLike<Output>;

export type InputPlan<Values extends RawValueMap, Input> = {
  readonly schema: z.ZodType<Values>;
  readonly parse: (raw: RawValueMap) => Input;
  readonly project: (values: Values) => Input;
};

export type ReadonlyEntryMetadata = Pick<
  ErasedEntryDefinition,
  "name" | "parameters" | "output"
>;

export type ReadonlyEndpointMetadata = {
  readonly entry: ReadonlyEntryMetadata;
  readonly channels: readonly EntryChannelBinding[];
};

export type Registration<Values extends RawValueMap, Input, Context, Output> = {
  readonly endpoint: ReadonlyEndpointMetadata;
  readonly entry: ReadonlyEntryMetadata;
  readonly binding: EntryChannelBinding;
  readonly parameters: readonly ParameterDescription[];
  readonly input: InputPlan<Values, Input>;
  readonly handler: HandlerView<Input, Context, Output>;
};

type HandlerOf<Endpoint extends EntryTreeEndpoint> =
  Endpoint extends EntryTreeEndpoint<
    ErasedEntryDefinition,
    infer Handler,
    readonly EntryChannelBinding[]
  >
    ? Handler
    : never;

export type ContextFor<Endpoint extends EntryTreeEndpoint> = CollectionContext<
  HandlerOf<Endpoint>
>;

export type OutputFor<Endpoint extends EntryTreeEndpoint> =
  Endpoint extends EntryTreeEndpoint<
    ErasedEntryDefinition,
    infer Handler,
    readonly EntryChannelBinding[]
  >
    ? Awaited<ReturnType<Handler>>
    : never;

export type EndpointForChannel<
  Endpoint extends EntryTreeEndpoint,
  ChannelName extends Channel,
> =
  Endpoint extends EntryTreeEndpoint<
    ErasedEntryDefinition,
    Callable,
    infer Channels
  >
    ? ChannelName extends Channels[number]["channel"]
      ? Endpoint
      : never
    : never;

export type EntryTreeSource = EntryTreeDefinition | EntryTreeNode;

export type EndpointsOfSource<Source extends EntryTreeSource> =
  Source extends EntryTreeDefinition
    ? EndpointsOfTree<Source>
    : Source extends EntryTreeNode
      ? EndpointsOfNode<Source>
      : never;

/**
 * The one intentional type-erasure boundary. Runtime collections retain the
 * original registrations; this package, and not a consumer, pays the cast.
 */
export function packRegistrationCollection<Collection>(
  registrations: readonly unknown[],
): Collection {
  const items = ownedArray(registrations);
  return ownedRecord({
    length: items.length,
    forEach(visit: (item: unknown) => void): void {
      items.forEach(visit);
    },
  }) as unknown as Collection;
}
