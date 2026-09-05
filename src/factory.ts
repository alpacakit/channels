import type {
  Callable,
  ChannelSegmentOverride,
  CommandDocumentation,
  CommandDocumentationInput,
  EndpointsOfNode,
  EntryChannelBinding,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ErasedEntryDefinition,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import { EntryTreeDefinitionError } from "./schema.js";
import type { Channel } from "./values.js";

const ENTRY_TREE_MERGE_ISSUE = {
  conflictingDocumentation: "conflicting node documentation",
} as const;

const EMPTY_COMMAND_DOCUMENTATION: CommandDocumentation = ownedRecord({
  remarks: ownedArray([]),
  relatedDocs: ownedArray([]),
});

export function defineEntryTree<const Node extends EntryTreeNode>(
  root: Node,
): EntryTreeDefinition<EndpointsOfNode<Node>> {
  return ownedRecord({ root }) as unknown as EntryTreeDefinition<
    EndpointsOfNode<Node>
  >;
}

export function defineEntryNode<
  const Endpoints extends readonly EntryTreeEndpoint[] = readonly [],
  const Children extends readonly EntryTreeNode[] = readonly [],
>(input: {
  readonly name: string;
  readonly description: string;
  readonly documentation?: CommandDocumentationInput;
  readonly segments?: readonly ChannelSegmentOverride[];
  readonly endpoints?: Endpoints;
  readonly children?: Children;
}): EntryTreeNode<Endpoints[number] | EndpointsOfNode<Children[number]>> {
  return ownedRecord({
    name: input.name,
    description: input.description,
    documentation: normalizeCommandDocumentation(input.documentation),
    segments: ownedArray(input.segments ?? []),
    endpoints: ownedArray(input.endpoints ?? []),
    children: ownedArray(input.children ?? []),
  }) as unknown as EntryTreeNode<
    Endpoints[number] | EndpointsOfNode<Children[number]>
  >;
}

export function mergeEntryTreeNodes<
  const Nodes extends readonly EntryTreeNode[],
>(nodes: Nodes): readonly EntryTreeNode<EndpointsOfNode<Nodes[number]>>[] {
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
      item.frame.documentation = mergeCommandDocumentation(
        item.frame.nodes,
        item.frame.path,
        issues,
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
    const documentation = item.frame.documentation;
    if (!segments || !documentation) {
      throw new EntryTreeDefinitionError([
        `${item.frame.path}: node was not prepared for merging`,
      ]);
    }
    merged.set(
      item.frame,
      defineEntryNode({
        name: first.name,
        description: first.description,
        documentation,
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

  return ownedArray(
    rootFrames.map((frame) => {
      const node = merged.get(frame);
      if (!node) {
        throw new EntryTreeDefinitionError([
          `${frame.path}: node was not merged`,
        ]);
      }
      return node;
    }),
  ) as unknown as readonly EntryTreeNode<EndpointsOfNode<Nodes[number]>>[];
}

type MergeFrame = {
  readonly nodes: readonly EntryTreeNode[];
  readonly path: string;
  segments: readonly ChannelSegmentOverride[] | null;
  documentation: CommandDocumentation | null;
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
    documentation: null,
    children: [],
  };
}

function normalizeCommandDocumentation(
  input: CommandDocumentationInput | undefined,
): CommandDocumentation {
  if (input === undefined) {
    return EMPTY_COMMAND_DOCUMENTATION;
  }
  return ownedRecord({
    remarks: ownedArray(input.remarks ?? []),
    relatedDocs: ownedArray(input.relatedDocs ?? []),
  });
}

function mergeCommandDocumentation(
  nodes: readonly EntryTreeNode[],
  path: string,
  issues: string[],
): CommandDocumentation {
  const claims = nodes
    .map((node) => node.documentation)
    .filter(hasCommandDocumentationClaim);
  const first = claims[0] ?? EMPTY_COMMAND_DOCUMENTATION;
  if (
    claims.slice(1).some((claim) => !sameCommandDocumentation(first, claim))
  ) {
    issues.push(`${path}: ${ENTRY_TREE_MERGE_ISSUE.conflictingDocumentation}`);
  }
  return first;
}

function hasCommandDocumentationClaim(
  documentation: CommandDocumentation,
): boolean {
  return (
    documentation.remarks.length > 0 || documentation.relatedDocs.length > 0
  );
}

function sameCommandDocumentation(
  left: CommandDocumentation,
  right: CommandDocumentation,
): boolean {
  return (
    sameStringList(left.remarks, right.remarks) &&
    sameStringList(left.relatedDocs, right.relatedDocs)
  );
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameChannelPayload(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameChannelPayload(value, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameChannelPayload(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
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
      !sameChannelPayload(existing.segment, segment.segment)
    ) {
      issues.push(`${path}: conflicting ${segment.channel} segment overrides`);
      continue;
    }
    byChannel.set(segment.channel, segment);
  }
  return [...byChannel.values()];
}

/**
 * Bundles an Entry definition object with channel bindings. This factory does
 * not register or execute an application handler.
 */
type CheckedHandlerDefinition<Arguments extends readonly unknown[]> =
  number extends Arguments["length"]
    ? { readonly handler: never }
    : Exclude<Arguments["length"], 0 | 1 | 2> extends never
      ? unknown
      : { readonly handler: never };

type HandlerArgumentsFor<Projection, Arguments extends readonly unknown[]> = {
  readonly [Index in keyof Arguments]: Index extends "0"
    ? Projection
    : Arguments[Index];
};

type RegisteredHandler<Arguments extends readonly unknown[], Result> = (
  ...args: Arguments
) => Result;

export function defineEntryEndpoint<
  const Entry extends ErasedEntryDefinition,
  const Handler extends Callable,
  const Arguments extends readonly unknown[],
  Result,
  const Channels extends readonly EntryChannelBinding[],
>(
  entry: Entry,
  definition: {
    readonly handler: Handler &
      RegisteredHandler<Arguments, Result> &
      RegisteredHandler<
        HandlerArgumentsFor<ReturnType<Entry["project"]>, Arguments>,
        Result
      >;
    readonly channels: Channels;
  } & CheckedHandlerDefinition<Arguments>,
): EntryTreeEndpoint<Entry, Handler, Channels> {
  if (definition.handler.length > 2) {
    throw new EntryTreeDefinitionError([
      `${entry.name}: handler must accept zero to two parameters`,
    ]);
  }
  return ownedRecord({
    entry,
    handler: definition.handler,
    channels: ownedArray(definition.channels),
  }) as unknown as EntryTreeEndpoint<Entry, Handler, Channels>;
}
