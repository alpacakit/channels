import type { JsonValue } from "@alpacaloop/core";
import type {
  ChannelSegmentOverride,
  EntryDefinition,
  EntryDefinitionWithOutput,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ParameterSet,
  TypedEntryChannelBinding,
  TypedEntryTreeEndpoint,
} from "./model.js";
import type { Channel } from "./values.js";

export function defineEntryTree(root: EntryTreeNode): EntryTreeDefinition {
  return { root } as EntryTreeDefinition;
}

export function defineEntryNode(input: {
  readonly name: string;
  readonly description: string;
  readonly segments?: readonly ChannelSegmentOverride[];
  readonly endpoints?: readonly EntryTreeEndpoint[];
  readonly children?: readonly EntryTreeNode[];
}): EntryTreeNode {
  return {
    name: input.name,
    description: input.description,
    segments: input.segments ?? [],
    endpoints: input.endpoints ?? [],
    children: input.children ?? [],
  } as EntryTreeNode;
}

export function defineEntryEndpoint<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
>(
  entry: EntryDefinitionWithOutput<Name, Parameters, Projection, Output>,
  ...channels: readonly TypedEntryChannelBinding<
    Channel,
    NoInfer<Parameters[number]["name"]>
  >[]
): TypedEntryTreeEndpoint<
  EntryDefinitionWithOutput<Name, Parameters, Projection, Output>
>;
export function defineEntryEndpoint<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(
  entry: EntryDefinition<Name, Parameters, Projection>,
  ...channels: readonly TypedEntryChannelBinding<
    Channel,
    NoInfer<Parameters[number]["name"]>
  >[]
): TypedEntryTreeEndpoint<EntryDefinition<Name, Parameters, Projection>>;
export function defineEntryEndpoint(
  entry: EntryTreeEndpoint["entry"],
  ...channels: readonly TypedEntryChannelBinding<Channel, string>[]
): EntryTreeEndpoint {
  return { entry, channels } as unknown as EntryTreeEndpoint;
}
