import type { JsonValue } from "@alpacaloop/core";
import type {
  ChannelSegmentOverride,
  CommandDocumentation,
  EntryChannelBinding,
  EntryDefinition,
  EntryDefinitionWithOutput,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ParameterSet,
} from "./model.js";
import { EntryTreeDefinitionError } from "./schema.js";
import type { Channel } from "./values.js";

const ENTRY_TREE_MERGE_ISSUE = {
  conflictingDocumentation: "conflicting node documentation",
} as const;

const EMPTY_COMMAND_DOCUMENTATION: CommandDocumentation = {
  remarks: [],
  relatedDocs: [],
};

export function defineEntryTree(root: EntryTreeNode): EntryTreeDefinition {
  return { root } as EntryTreeDefinition;
}

export function defineEntryNode(input: {
  readonly name: string;
  readonly description: string;
  readonly documentation?: CommandDocumentation;
  readonly segments?: readonly ChannelSegmentOverride[];
  readonly endpoints?: readonly EntryTreeEndpoint[];
  readonly children?: readonly EntryTreeNode[];
}): EntryTreeNode {
  return {
    name: input.name,
    description: input.description,
    documentation: input.documentation ?? EMPTY_COMMAND_DOCUMENTATION,
    segments: input.segments ?? [],
    endpoints: input.endpoints ?? [],
    children: input.children ?? [],
  } as EntryTreeNode;
}

export function mergeEntryTreeNodes(
  nodes: readonly EntryTreeNode[],
): readonly EntryTreeNode[] {
  const rootFrames = groupNodes(nodes).map((group) =>
    createMergeFrame(group, ""),
  );
  const pending = rootFrames
    .map((frame) => ({ frame, expanded: false }))
    .reverse();
  const merged = new Map<MergeFrame, EntryTreeNode>();

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) {
      continue;
    }
    if (!item.expanded) {
      const first = firstNode(item.frame);
      const issues = item.frame.nodes
        .slice(1)
        .filter((node) => node.description !== first.description)
        .map(() => `${item.frame.path}: conflicting node descriptions`);
      issues.push(
        ...item.frame.nodes
          .slice(1)
          .filter(
            (node) =>
              JSON.stringify(node.documentation) !==
              JSON.stringify(first.documentation),
          )
          .map(
            () =>
              `${item.frame.path}: ${ENTRY_TREE_MERGE_ISSUE.conflictingDocumentation}`,
          ),
      );
      item.frame.segments = mergeSegments(
        item.frame.nodes,
        item.frame.path,
        issues,
      );
      if (issues.length > 0) {
        throw new EntryTreeDefinitionError(issues);
      }
      item.frame.children = groupNodes(
        item.frame.nodes.flatMap((node) => node.children),
      ).map((group) => createMergeFrame(group, item.frame.path));
      pending.push({ frame: item.frame, expanded: true });
      for (const child of [...item.frame.children].reverse()) {
        pending.push({ frame: child, expanded: false });
      }
      continue;
    }

    const first = firstNode(item.frame);
    const segments = item.frame.segments;
    if (!segments) {
      throw new EntryTreeDefinitionError([
        `${item.frame.path}: node was not prepared for merging`,
      ]);
    }
    merged.set(
      item.frame,
      defineEntryNode({
        name: first.name,
        description: first.description,
        documentation: first.documentation,
        segments,
        endpoints: [
          ...new Set(item.frame.nodes.flatMap((node) => node.endpoints)),
        ],
        children: item.frame.children.map((child) => {
          const node = merged.get(child);
          if (!node) {
            throw new EntryTreeDefinitionError([
              `${child.path}: child node was not merged`,
            ]);
          }
          return node;
        }),
      }),
    );
  }

  return rootFrames.map((frame) => {
    const node = merged.get(frame);
    if (!node) {
      throw new EntryTreeDefinitionError([
        `${frame.path}: node was not merged`,
      ]);
    }
    return node;
  });
}

type MergeFrame = {
  readonly nodes: readonly EntryTreeNode[];
  readonly path: string;
  segments: readonly ChannelSegmentOverride[] | null;
  children: MergeFrame[];
};

function createMergeFrame(
  nodes: readonly EntryTreeNode[],
  parentPath: string,
): MergeFrame {
  const first = nodes[0];
  if (!first) {
    throw new EntryTreeDefinitionError(["cannot merge an empty node group"]);
  }
  return {
    nodes,
    path: parentPath ? `${parentPath}/${first.name}` : first.name,
    segments: null,
    children: [],
  };
}

function groupNodes(
  nodes: readonly EntryTreeNode[],
): readonly (readonly EntryTreeNode[])[] {
  const grouped = new Map<string, EntryTreeNode[]>();
  for (const node of nodes) {
    const group = grouped.get(node.name);
    if (group) {
      group.push(node);
    } else {
      grouped.set(node.name, [node]);
    }
  }
  return [...grouped.values()];
}

function firstNode(frame: MergeFrame): EntryTreeNode {
  const first = frame.nodes[0];
  if (!first) {
    throw new EntryTreeDefinitionError(["cannot merge an empty node group"]);
  }
  return first;
}

function mergeSegments(
  nodes: readonly EntryTreeNode[],
  path: string,
  issues: string[],
): readonly ChannelSegmentOverride[] {
  const byChannel = new Map<Channel, ChannelSegmentOverride>();
  for (const segment of nodes.flatMap((node) => node.segments)) {
    const existing = byChannel.get(segment.channel);
    if (
      existing !== undefined &&
      JSON.stringify(existing.segment) !== JSON.stringify(segment.segment)
    ) {
      issues.push(`${path}: conflicting ${segment.channel} segment overrides`);
      continue;
    }
    byChannel.set(segment.channel, segment);
  }
  return [...byChannel.values()];
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
