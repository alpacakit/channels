import { describe, expectTypeOf, it } from "vitest";
import {
  bindCliEntry,
  createCliRouter,
  isCliResolvedEndpoint,
  overrideCliSegment,
} from "../src/cli.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  ENTRY_DECODE_RESULT_KIND,
  type EntryTreeDefinition,
  type EntryTreeEndpoint,
  type EntryTreeNode,
  required,
} from "../src/index.js";
import { bindMcpEntry, defineMcpBinding, parseMcpEntry } from "../src/mcp.js";

describe("entry tree builder types", () => {
  it("keeps parameter-name safety in builders and erases stored endpoint types", () => {
    const entry = defineEntry({
      name: "hint",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required<string>(),
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
    const explicitMcp = defineMcpBinding<typeof entry.parameters>({
      parameters: [{ parameterName: "query" }],
    });
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
    expectTypeOf(explicitMcp.parameters[0]?.parameterName).toEqualTypeOf<
      "query" | undefined
    >();
    expectTypeOf(endpoint).toMatchTypeOf<EntryTreeEndpoint>();
    expectTypeOf(endpoint.entry).toEqualTypeOf<typeof entry>();
    expectTypeOf(tree.root.endpoints[0]).toEqualTypeOf<
      EntryTreeEndpoint | undefined
    >();
    expectTypeOf(tree).toEqualTypeOf<EntryTreeDefinition>();
    expectTypeOf({
      name: "raw",
      description: "Raw",
      segments: [],
      endpoints: [],
      children: [],
    }).not.toMatchTypeOf<EntryTreeNode>();

    const result = createCliRouter(tree).resolve(["--query", "value"]);
    if (isCliResolvedEndpoint(result, endpoint)) {
      expectTypeOf(result.entry).toEqualTypeOf<typeof entry>();
      const projection: string | undefined = result.projection;
      const values: { readonly query?: string } = result.values;
      expectTypeOf(projection).toEqualTypeOf<string | undefined>();
      expectTypeOf(values).toEqualTypeOf<{ readonly query?: string }>();
    }
    const mcpResult = parseMcpEntry({ endpoint, raw: { query: "value" } });
    if (mcpResult.kind === ENTRY_DECODE_RESULT_KIND.resolved) {
      const projection: string | undefined = mcpResult.projection;
      expectTypeOf(projection).toEqualTypeOf<string | undefined>();
    }

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
