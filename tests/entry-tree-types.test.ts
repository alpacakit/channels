import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  bindCliEntry,
  createCliRouter,
  isCliResolvedEndpoint,
  overrideCliSegment,
} from "../src/cli.js";
import {
  codecs,
  type EntryChannelBinding,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  ENTRY_DECODE_RESULT_KIND,
  type EntryTreeDefinition,
  type EntryTreeEndpoint,
  type EntryTreeNode,
  optional,
  required,
  VALUE_SHAPE_KIND,
  type ValueShape,
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
    expectTypeOf(cli).toMatchTypeOf<EntryChannelBinding<"cli", "query">>();
    expectTypeOf(explicitMcp.parameters[0]?.parameterName).toEqualTypeOf<
      "query" | undefined
    >();
    expectTypeOf(endpoint).toMatchTypeOf<EntryTreeEndpoint>();
    expectTypeOf(endpoint).toEqualTypeOf<EntryTreeEndpoint<typeof entry>>();
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
      const projection: string = result.projection;
      expectTypeOf(projection).toEqualTypeOf<string>();
    }
    const mcpResult = parseMcpEntry({ endpoint, raw: { query: "value" } });
    if (mcpResult.kind === ENTRY_DECODE_RESULT_KIND.resolved) {
      const projection: string = mcpResult.projection;
      expectTypeOf(projection).toEqualTypeOf<string>();
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

  it("materializes required and defaulted values in projection types", () => {
    defineEntry({
      name: "materialized",
      parameters: [
        defineParameter({
          name: "requiredValue",
          codec: codecs.string(),
          requirement: required(),
          description: "Required",
        }),
        defineParameter({
          name: "defaultedValue",
          codec: codecs.positiveInteger(),
          requirement: optional<number>({ default: 2 }),
          description: "Defaulted",
        }),
        defineParameter({
          name: "omittedValue",
          codec: codecs.boolean(),
          requirement: optional<boolean>(),
          description: "Omitted",
        }),
      ],
      project: ({ values }) => {
        expectTypeOf(values.requiredValue).toEqualTypeOf<string>();
        expectTypeOf(values.defaultedValue).toEqualTypeOf<number>();
        expectTypeOf(values.omittedValue).toEqualTypeOf<boolean | undefined>();
        return values;
      },
    });
  });

  it("stores only non-default CLI binding choices", () => {
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "items",
          flags: ["--item"],
          repeatMode: "comma_or_repeat",
        },
        {
          kind: "option",
          parameterName: "enabled",
          flags: ["--enabled"],
          negated: true,
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "items",
          flags: ["--item"],
          // @ts-expect-error repeated values are the implicit array default
          repeatMode: "repeat",
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "enabled",
          flags: ["--enabled"],
          // @ts-expect-error absence represents the non-negated choice
          negated: false,
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "query",
          // @ts-expect-error CLI option flags must begin with a hyphen
          flags: ["query"],
        },
      ],
    });
  });

  it("ties codec values to scalar or flat-array shapes", () => {
    codecs.define({
      // @ts-expect-error a string shape requires a string schema
      schema: z.boolean(),
      shape: { kind: VALUE_SHAPE_KIND.string },
    });
    const nestedArrayShape = {
      kind: VALUE_SHAPE_KIND.array,
      element: {
        // @ts-expect-error CLI array elements must be scalar
        kind: VALUE_SHAPE_KIND.array,
        element: { kind: VALUE_SHAPE_KIND.string },
      },
    } satisfies ValueShape;
    expectTypeOf(nestedArrayShape.kind).toEqualTypeOf<"array">();
  });
});
