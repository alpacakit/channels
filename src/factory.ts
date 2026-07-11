import type { JsonValue } from "@alpacaloop/core";
import type {
  ChannelSegmentOverride,
  EntryChannelBinding,
  EntryDefinition,
  EntryDefinitionWithOutput,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ParameterSet,
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
  ...channels: readonly EntryChannelBinding<
    Channel,
    NoInfer<Parameters[number]["name"]>
  >[]
): EntryTreeEndpoint<
  EntryDefinitionWithOutput<Name, Parameters, Projection, Output>
>;
export function defineEntryEndpoint<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(
  entry: EntryDefinition<Name, Parameters, Projection>,
  ...channels: readonly EntryChannelBinding<
    Channel,
    NoInfer<Parameters[number]["name"]>
  >[]
): EntryTreeEndpoint<EntryDefinition<Name, Parameters, Projection>>;
export function defineEntryEndpoint(
  entry: EntryTreeEndpoint["entry"],
  ...channels: readonly EntryChannelBinding<Channel, string>[]
): EntryTreeEndpoint {
  return { entry, channels } as unknown as EntryTreeEndpoint;
}
