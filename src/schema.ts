import type {
  EntryChannelBinding,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
} from "./model.js";
import type { EntryTreeSource } from "./registration.js";

export { EntryTreeDefinitionError } from "./definition-error.js";

export interface EntryTreeVisitor {
  readonly visitNode: (
    node: EntryTreeNode,
    path: readonly string[],
    root: boolean,
  ) => void;
  readonly visitEndpoint: (
    endpoint: EntryTreeEndpoint,
    node: EntryTreeNode,
    path: readonly string[],
    root: boolean,
  ) => void;
}

export function isEntryTreeDefinition(
  source: EntryTreeSource,
): source is EntryTreeDefinition {
  return Object.hasOwn(source, "root");
}

export function visitEntryTreeSource(
  source: EntryTreeSource,
  visitor: EntryTreeVisitor,
): void {
  const tree = isEntryTreeDefinition(source);
  const root = tree ? source.root : source;
  const stack: VisitFrame[] = [
    {
      node: root,
      path: tree ? [] : [root.name],
      root: true,
    },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    visitor.visitNode(current.node, current.path, current.root);
    for (const endpoint of current.node.endpoints) {
      visitor.visitEndpoint(endpoint, current.node, current.path, current.root);
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index];
      if (child !== undefined) {
        stack.push({
          node: child,
          path: [...current.path, child.name],
          root: false,
        });
      }
    }
  }
}

export function visitEntryTree(
  tree: EntryTreeDefinition,
  visitor: Omit<EntryTreeVisitor, "visitNode" | "visitEndpoint"> & {
    readonly visitNode: (node: EntryTreeNode, path: readonly string[]) => void;
    readonly visitEndpoint: (
      endpoint: EntryTreeEndpoint,
      node: EntryTreeNode,
      path: readonly string[],
    ) => void;
  },
): void {
  visitEntryTreeSource(tree, {
    visitNode: (node, path) =>
      visitor.visitNode(node, [tree.root.name, ...path]),
    visitEndpoint: (endpoint, node, path) =>
      visitor.visitEndpoint(endpoint, node, [tree.root.name, ...path]),
  });
}

export function validateEntryTreeStructure(
  source: EntryTreeSource,
): readonly string[] {
  const root = isEntryTreeDefinition(source) ? source.root : source;
  const issues: string[] = [];
  const placements = new Map<EntryTreeNode, NodePlacement>();
  const active = new Set<EntryTreeNode>();
  const stack: StructureFrame[] = [
    { kind: STRUCTURE_FRAME_KIND.enter, node: root, parent: null },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }
    if (frame.kind === STRUCTURE_FRAME_KIND.exit) {
      active.delete(frame.node);
      continue;
    }
    const placement: NodePlacement = { node: frame.node, parent: frame.parent };
    const firstPlacement = placements.get(frame.node);
    if (firstPlacement !== undefined) {
      const issue = active.has(frame.node)
        ? "TreeNode cycle"
        : "TreeNode is placed more than once";
      issues.push(
        `${formatPlacement(placement)}: ${issue}; first placement is ${formatPlacement(firstPlacement)}`,
      );
      continue;
    }
    placements.set(frame.node, placement);
    active.add(frame.node);
    validateNode(placement, issues);
    stack.push({ kind: STRUCTURE_FRAME_KIND.exit, node: frame.node });
    for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
      const child = frame.node.children[index];
      if (child !== undefined) {
        stack.push({
          kind: STRUCTURE_FRAME_KIND.enter,
          node: child,
          parent: placement,
        });
      }
    }
  }
  return issues;
}

const STRUCTURE_FRAME_KIND = {
  enter: "enter",
  exit: "exit",
} as const;

type StructureFrame =
  | {
      readonly kind: typeof STRUCTURE_FRAME_KIND.enter;
      readonly node: EntryTreeNode;
      readonly parent: NodePlacement | null;
    }
  | {
      readonly kind: typeof STRUCTURE_FRAME_KIND.exit;
      readonly node: EntryTreeNode;
    };

type NodePlacement = {
  readonly node: EntryTreeNode;
  readonly parent: NodePlacement | null;
};

function validateNode(placement: NodePlacement, issues: string[]): void {
  const { node } = placement;
  const location = formatPlacement(placement);
  if (node.name.length === 0) {
    issues.push(`${location}: node name must not be empty`);
  }
  const childNames = new Set<string>();
  for (const child of node.children) {
    if (childNames.has(child.name)) {
      issues.push(
        `${location}: duplicate child name ${JSON.stringify(child.name)}; merge same-name nodes explicitly`,
      );
    }
    childNames.add(child.name);
  }
  const overrideChannels = new Set<string>();
  for (const override of node.segments) {
    if (overrideChannels.has(override.channel)) {
      issues.push(
        `${location}: duplicate ${override.channel} segment override`,
      );
    }
    overrideChannels.add(override.channel);
  }
  for (const endpoint of node.endpoints) {
    const channels = new Set<string>();
    for (const channelBinding of endpoint.channels) {
      if (channels.has(channelBinding.channel)) {
        issues.push(
          `${location}#${endpoint.entry.name}: duplicate ${channelBinding.channel} channel binding`,
        );
      }
      channels.add(channelBinding.channel);
    }
  }
}

function formatPlacement(placement: NodePlacement): string {
  const path: string[] = [];
  let current: NodePlacement | null = placement;
  while (current !== null) {
    path.push(current.node.name);
    current = current.parent;
  }
  return formatTreePath(path.reverse());
}

export function findChannelBinding(
  endpoint: EntryTreeEndpoint,
  channel: EntryChannelBinding["channel"],
): EntryChannelBinding | null {
  return (
    endpoint.channels.find((candidate) => candidate.channel === channel) ?? null
  );
}

export function formatTreePath(path: readonly string[]): string {
  return path.map((segment) => segment || "<empty>").join("/");
}

type VisitFrame = {
  readonly node: EntryTreeNode;
  readonly path: readonly string[];
  readonly root: boolean;
};
