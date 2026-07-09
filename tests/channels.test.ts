import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  booleanChannelValueCodec,
  defineChannelEntry,
  defineChannelParameter,
  optionalChannelParameter,
  positiveIntegerChannelValueCodec,
  projectChannelEntry,
  stringChannelValueCodec,
  stringEnumListChannelValueCodec,
  stringListChannelValueCodec,
} from "../src/index.js";
import {
  CHANNEL_CLI_BOOLEAN_MODE,
  CHANNEL_CLI_VALUE_KIND,
  createCliChannelOptions,
  defineCliChannelBinding,
  readCliChannelParameterValues,
} from "../src/cli.js";
import {
  createMcpChannelInputSchema,
  defineMcpChannelBinding,
  readMcpChannelParameterValues,
} from "../src/mcp.js";

const TestIntentValues = ["add-field", "cli-change"] as const;

const TestEntry = defineChannelEntry({
  name: "hint",
  parameters: [
    defineChannelParameter({
      name: "symbol",
      codec: stringListChannelValueCodec(),
      requirement: optionalChannelParameter(),
      description: "Exact symbol name",
    }),
    defineChannelParameter({
      name: "intent",
      codec: stringEnumListChannelValueCodec(TestIntentValues),
      requirement: optionalChannelParameter(),
      description: "Intent filter",
    }),
    defineChannelParameter({
      name: "exported",
      codec: booleanChannelValueCodec(),
      requirement: optionalChannelParameter(),
      description: "Exported filter",
    }),
    defineChannelParameter({
      name: "depth",
      codec: positiveIntegerChannelValueCodec({ max: 5 }),
      requirement: optionalChannelParameter(2),
      description: "Traversal depth",
    }),
    defineChannelParameter({
      name: "verbose",
      codec: booleanChannelValueCodec(),
      requirement: optionalChannelParameter(false),
      description: "Verbose logging",
    }),
    defineChannelParameter({
      name: "internalOnly",
      codec: stringChannelValueCodec(),
      requirement: optionalChannelParameter(),
      description: "Hidden from MCP",
    }),
  ],
  project: ({ values }) => values,
});

const TestCliBinding = defineCliChannelBinding({
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

const TestMcpBinding = defineMcpChannelBinding({
  parameters: [
    { parameterName: "symbol" },
    { parameterName: "intent" },
    { parameterName: "depth" },
  ],
});

describe("@alpacaloop/channels CLI binding", () => {
  it("generates CLI metadata and normalizes raw CLI values", () => {
    expect(
      createCliChannelOptions({ entry: TestEntry, binding: TestCliBinding }),
    ).toEqual([
      expect.objectContaining({
        name: "symbol",
        flags: ["--symbol"],
        kind: CHANNEL_CLI_VALUE_KIND.string,
        multiple: true,
      }),
      expect.objectContaining({
        name: "intent",
        choices: ["add-field", "cli-change"],
        kind: CHANNEL_CLI_VALUE_KIND.stringEnum,
        multiple: true,
      }),
      expect.objectContaining({
        name: "exported",
        choices: [],
        kind: CHANNEL_CLI_VALUE_KIND.boolean,
        booleanMode: CHANNEL_CLI_BOOLEAN_MODE.value,
        multiple: false,
      }),
      expect.objectContaining({
        name: "depth",
        defaultValue: 2,
        kind: CHANNEL_CLI_VALUE_KIND.positiveInteger,
      }),
      expect.objectContaining({
        name: "verbose",
        kind: CHANNEL_CLI_VALUE_KIND.boolean,
        booleanMode: CHANNEL_CLI_BOOLEAN_MODE.flag,
        defaultValue: false,
        multiple: false,
      }),
    ]);

    const values = readCliChannelParameterValues({
      entry: TestEntry,
      binding: TestCliBinding,
      raw: {
        symbol: ["AdapterContext"],
        intent: ["add-field"],
        exported: "false",
      },
    });

    expect(projectChannelEntry(TestEntry, values)).toEqual({
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
    const schema = createMcpChannelInputSchema({
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

    const values = readMcpChannelParameterValues({
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
