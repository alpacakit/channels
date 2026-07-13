import type { JsonValue } from "@alpacaloop/core";
import type {
  CommandDocumentation,
  EntryTreeDefinition,
  EntryTreeNode,
  ErasedEntryDefinition,
  ValueShape,
} from "./model.js";
import {
  ENTRY_OUTPUT_DESCRIPTION_KIND,
  PARAMETER_PRESENCE,
  PARAMETER_REQUIREMENT_KIND,
} from "./values.js";

const ENTRY_INTROSPECTION_ERROR = {
  missingChild: "Entry tree child could not be described",
  missingRoot: "Entry tree root could not be described",
} as const;

export type CommandPath = readonly string[];

export type ParameterRequirementDescription =
  | { readonly kind: typeof PARAMETER_REQUIREMENT_KIND.required }
  | {
      readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optional;
    }
  | {
      readonly kind: typeof PARAMETER_REQUIREMENT_KIND.optionalWithDefault;
      readonly defaultValue: JsonValue;
    };

export type ParameterDescription = {
  readonly name: string;
  readonly description: string;
  readonly requirement: ParameterRequirementDescription;
  readonly shape: ValueShape;
};

export type EntryOutputDescription =
  | { readonly kind: typeof ENTRY_OUTPUT_DESCRIPTION_KIND.typed }
  | { readonly kind: typeof ENTRY_OUTPUT_DESCRIPTION_KIND.none };

export type EntryDescription = {
  readonly name: string;
  readonly parameters: readonly ParameterDescription[];
  readonly output: EntryOutputDescription;
};

export type CommandDescription = {
  readonly path: CommandPath;
  readonly name: string;
  readonly description: string;
  readonly documentation: CommandDocumentation;
  readonly endpoints: readonly EntryDescription[];
  readonly children: readonly CommandDescription[];
};

type EntryDescriptionFrame = {
  readonly node: EntryTreeNode;
  readonly path: CommandPath;
  readonly expanded: boolean;
};

export function describeEntry(entry: ErasedEntryDefinition): EntryDescription {
  return {
    name: entry.name,
    parameters: entry.parameters.map((parameter) => ({
      name: parameter.name,
      description: parameter.description,
      requirement: describeParameterRequirement(parameter.requirement),
      shape: parameter.codec.shape,
    })),
    output: {
      kind:
        entry.output === undefined
          ? ENTRY_OUTPUT_DESCRIPTION_KIND.none
          : ENTRY_OUTPUT_DESCRIPTION_KIND.typed,
    },
  };
}

export function describeEntryTree(
  tree: EntryTreeDefinition,
): CommandDescription {
  const frames = new Map<EntryTreeNode, CommandDescription>();
  const stack: EntryDescriptionFrame[] = [
    { node: tree.root, path: [], expanded: false },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (!current.expanded) {
      stack.push({ ...current, expanded: true });
      for (
        let index = current.node.children.length - 1;
        index >= 0;
        index -= 1
      ) {
        const child = current.node.children[index];
        if (child) {
          stack.push({
            node: child,
            path: [...current.path, child.name],
            expanded: false,
          });
        }
      }
      continue;
    }

    frames.set(current.node, {
      path: current.path,
      name: current.node.name,
      description: current.node.description,
      documentation: current.node.documentation,
      endpoints: current.node.endpoints.map((endpoint) =>
        describeEntry(endpoint.entry),
      ),
      children: current.node.children.map((child) => {
        const description = frames.get(child);
        if (description === undefined) {
          throw new Error(ENTRY_INTROSPECTION_ERROR.missingChild);
        }
        return description;
      }),
    });
  }

  const root = frames.get(tree.root);
  if (root === undefined) {
    throw new Error(ENTRY_INTROSPECTION_ERROR.missingRoot);
  }
  return root;
}

export function describeParameterRequirement(
  requirement: ErasedEntryDefinition["parameters"][number]["requirement"],
): ParameterRequirementDescription {
  if (requirement.presence === PARAMETER_PRESENCE.required) {
    return { kind: PARAMETER_REQUIREMENT_KIND.required };
  }
  if (requirement.defaultValue === undefined) {
    return { kind: PARAMETER_REQUIREMENT_KIND.optional };
  }
  return {
    kind: PARAMETER_REQUIREMENT_KIND.optionalWithDefault,
    defaultValue: requirement.defaultValue,
  };
}
