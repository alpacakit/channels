import type {
  EntryChannelBinding,
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
} from "./model.js";

export class EntryTreeDefinitionError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid entry tree definition:\n${issues.join("\n")}`);
    this.name = EntryTreeDefinitionError.name;
  }
}

export interface EntryTreeVisitor {
  visitNode(node: EntryTreeNode, path: readonly string[]): void;
  visitEndpoint(
    endpoint: EntryTreeEndpoint,
    node: EntryTreeNode,
    path: readonly string[],
  ): void;
}

export function visitEntryTree(
  tree: EntryTreeDefinition,
  visitor: EntryTreeVisitor,
): void {
  const stack: {
    readonly node: EntryTreeNode;
    readonly path: readonly string[];
  }[] = [{ node: tree.root, path: [] }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const path = [...current.path, current.node.name];
    visitor.visitNode(current.node, path);
    for (const endpoint of current.node.endpoints) {
      visitor.visitEndpoint(endpoint, current.node, path);
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index];
      if (child) {
        stack.push({ node: child, path });
      }
    }
  }
}

export function validateEntryTreeStructure(
  tree: EntryTreeDefinition,
): readonly string[] {
  const issues: string[] = [];
  visitEntryTree(tree, {
    visitNode(node, path) {
      const location = formatTreePath(path);
      if (node.name.length === 0) {
        issues.push(`${location}: node name must not be empty`);
      }
      const childNames = new Set<string>();
      for (const child of node.children) {
        if (childNames.has(child.name)) {
          issues.push(
            `${location}: duplicate child name ${JSON.stringify(child.name)}`,
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
    },
    visitEndpoint(endpoint, _node, path) {
      const location = `${formatTreePath(path)}#${endpoint.entry.name}`;
      const channels = new Set<string>();
      for (const channelBinding of endpoint.channels) {
        if (channels.has(channelBinding.channel)) {
          issues.push(
            `${location}: duplicate ${channelBinding.channel} channel binding`,
          );
        }
        channels.add(channelBinding.channel);
      }
    },
  });
  return issues;
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
