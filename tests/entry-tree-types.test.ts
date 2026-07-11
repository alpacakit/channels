import { describe, expectTypeOf, it } from "vitest";
import { bindCliEntry, overrideCliSegment } from "../src/cli.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryTreeDefinition,
  type EntryTreeEndpoint,
  type EntryTreeNode,
  required,
} from "../src/index.js";
import { bindMcpEntry, defineMcpBinding } from "../src/mcp.js";

describe("entry tree builder types", () => {
  it("keeps parameter-name safety in builders and erases stored endpoint types", () => {
    const entry = defineEntry({
      name: "hint",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
      ],
      project: ({ values }) => values.query,
    });
    const cli = bindCliEntry({
      parameters: [
        { kind: "option", parameterName: "query", flags: ["--query"] },
      ],
    });
    const mcp = bindMcpEntry(
      defineMcpBinding({ parameters: [{ parameterName: "query" }] }),
    );
    const endpoint = defineEntryEndpoint(entry, cli, mcp);
    const tree = defineEntryTree(
      defineEntryNode({
        name: "tool",
        description: "Tool",
        segments: [overrideCliSegment({ token: "t", aliases: ["tool"] })],
        endpoints: [endpoint],
      }),
    );

    expectTypeOf(cli.binding).toEqualTypeOf<unknown>();
    expectTypeOf(endpoint).toEqualTypeOf<EntryTreeEndpoint>();
    expectTypeOf(tree).toEqualTypeOf<EntryTreeDefinition>();
    expectTypeOf({
      name: "raw",
      description: "Raw",
      segments: [],
      endpoints: [],
      children: [],
    }).not.toMatchTypeOf<EntryTreeNode>();

    const invalidCli = bindCliEntry({
      parameters: [
        { kind: "option", parameterName: "missing", flags: ["--missing"] },
      ],
    });
    const invalidMcp = bindMcpEntry(
      defineMcpBinding({ parameters: [{ parameterName: "missing" }] }),
    );
    // @ts-expect-error the entry, not its bindings, fixes the parameter names
    defineEntryEndpoint(entry, invalidCli);
    // @ts-expect-error MCP bindings use the same NoInfer constraint
    defineEntryEndpoint(entry, invalidMcp);
  });
});
