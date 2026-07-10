import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  codecs,
  defineEntry,
  defineParameter,
  optional,
  projectEntry,
} from "../src/index.js";
import {
  CLI_BOOLEAN_MODE,
  CLI_VALUE_KIND,
  createCliOptions,
  defineCliBinding,
  parseCliValues,
} from "../src/cli.js";
import {
  createMcpInputSchema,
  defineMcpBinding,
  parseMcpValues,
} from "../src/mcp.js";

const TestIntentValues = ["add-field", "cli-change"] as const;

const TestEntry = defineEntry({
  name: "hint",
  parameters: [
    defineParameter({
      name: "symbol",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Exact symbol name",
    }),
    defineParameter({
      name: "intent",
      codec: codecs.stringEnumList(TestIntentValues),
      requirement: optional(),
      description: "Intent filter",
    }),
    defineParameter({
      name: "exported",
      codec: codecs.boolean(),
      requirement: optional(),
      description: "Exported filter",
    }),
    defineParameter({
      name: "depth",
      codec: codecs.positiveInteger({ max: 5 }),
      requirement: optional({ default: 2 }),
      description: "Traversal depth",
    }),
    defineParameter({
      name: "verbose",
      codec: codecs.boolean(),
      requirement: optional({ default: false }),
      description: "Verbose logging",
    }),
    defineParameter({
      name: "internalOnly",
      codec: codecs.string(),
      requirement: optional(),
      description: "Hidden from MCP",
    }),
  ],
  project: ({ values }) => values,
});

const TestCliBinding = defineCliBinding({
  parameters: [
    {
      parameterName: "symbol",
      flags: ["--symbol"],
    },
    {
      parameterName: "intent",
      flags: ["--intent"],
    },
    {
      parameterName: "exported",
      flags: ["--exported"],
    },
    {
      parameterName: "depth",
      flags: ["--depth"],
    },
    {
      parameterName: "verbose",
      flags: ["--verbose"],
    },
  ],
});

const TestMcpBinding = defineMcpBinding({
  parameters: [
    { parameterName: "symbol" },
    { parameterName: "intent" },
    { parameterName: "depth" },
  ],
});

describe("@alpacaloop/channels CLI binding", () => {
  it("generates CLI metadata and normalizes raw CLI values", () => {
    expect(
      createCliOptions({ entry: TestEntry, binding: TestCliBinding }),
    ).toEqual([
      expect.objectContaining({
        name: "symbol",
        flags: ["--symbol"],
        kind: CLI_VALUE_KIND.string,
        multiple: true,
        defaultValue: null,
        valueName: "symbol",
      }),
      expect.objectContaining({
        name: "intent",
        choices: ["add-field", "cli-change"],
        kind: CLI_VALUE_KIND.stringEnum,
        multiple: true,
      }),
      expect.objectContaining({
        name: "exported",
        choices: [],
        kind: CLI_VALUE_KIND.boolean,
        booleanMode: CLI_BOOLEAN_MODE.value,
        multiple: false,
        defaultValue: null,
        valueName: "exported",
      }),
      expect.objectContaining({
        name: "depth",
        defaultValue: 2,
        kind: CLI_VALUE_KIND.positiveInteger,
        valueName: "depth",
      }),
      expect.objectContaining({
        name: "verbose",
        kind: CLI_VALUE_KIND.boolean,
        booleanMode: CLI_BOOLEAN_MODE.flag,
        defaultValue: false,
        multiple: false,
        valueName: null,
      }),
    ]);

    const values = parseCliValues({
      entry: TestEntry,
      binding: TestCliBinding,
      raw: {
        symbol: ["AdapterContext"],
        intent: ["add-field"],
        exported: "false",
      },
    });

    expect(projectEntry(TestEntry, values)).toEqual({
      symbol: ["AdapterContext"],
      intent: ["add-field"],
      exported: false,
      depth: 2,
      verbose: false,
    });
  });
});

describe("@alpacaloop/channels MCP binding", () => {
  it("generates an exposed-parameter input schema and normalizes arguments", () => {
    const schema = createMcpInputSchema({
      entry: TestEntry,
      binding: TestMcpBinding,
    });

    expect(Object.keys(schema).sort()).toEqual(["depth", "intent", "symbol"]);
    expect(Object.hasOwn(schema, "internalOnly")).toBe(false);

    const jsonSchema = z.toJSONSchema(z.object(schema)) as {
      readonly properties?: {
        readonly symbol?: { readonly description?: string };
        readonly depth?: { readonly description?: string };
      };
    };
    expect(jsonSchema.properties?.symbol?.description).toBe(
      "Exact symbol name",
    );
    expect(jsonSchema.properties?.depth?.description).toBe("Traversal depth");

    expect(
      z.object(schema).parse({
        symbol: ["AdapterContext"],
        intent: ["cli-change"],
      }),
    ).toEqual({
      symbol: ["AdapterContext"],
      intent: ["cli-change"],
    });
    expect(z.object(schema).safeParse({ depth: 6 }).success).toBe(false);

    const values = parseMcpValues({
      entry: TestEntry,
      binding: TestMcpBinding,
      raw: { symbol: ["AdapterContext"] },
    });

    expect(values).toEqual({
      symbol: ["AdapterContext"],
      depth: 2,
    });
  });
});
