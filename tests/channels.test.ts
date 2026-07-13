import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  codecs,
  createOutputContract,
  defineEntry,
  defineEntryEndpoint,
  defineParameter,
  ENTRY_DECODE_RESULT_KIND,
  type EntryDefinition,
  type EntryDefinitionInput,
  type EntryDefinitionWithOutput,
  EntryInputError,
  EntryOutputContractError,
  type OutputContract,
  optional,
  requireEntryOutput,
  verifyEntryOutput,
} from "../src/index.js";
import {
  bindMcpEntry,
  createMcpEndpoint,
  createMcpOutputSchema,
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

const TestMcpBinding = ["symbol", "intent", "depth"] as const;

const TestEndpoint = defineEntryEndpoint(
  TestEntry,
  bindMcpEntry(...TestMcpBinding),
);

const TestOutputSchema = z
  .object({
    status: z.literal("ok"),
    count: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

type TestOutput = z.infer<typeof TestOutputSchema>;

const TestOutputEntry = defineEntry({
  name: "output",
  parameters: [],
  project: () => null,
  output: createOutputContract(TestOutputSchema),
});

const TestOutputEndpoint = defineEntryEndpoint(TestOutputEntry, bindMcpEntry());

const OutputlessEntry = defineEntry<
  "outputless",
  readonly [],
  null,
  { readonly status: "ok" }
>({
  name: "outputless",
  parameters: [],
  project: () => null,
});

const NonObjectSchemaEntry = defineEntry({
  name: "non-object-schema",
  parameters: [],
  project: () => null,
  output: createOutputContract(
    z.union([
      z
        .object({ kind: z.literal("first") })
        .strict()
        .readonly(),
      z
        .object({ kind: z.literal("second") })
        .strict()
        .readonly(),
    ]),
  ),
});

const NonObjectSchemaEndpoint = defineEntryEndpoint(
  NonObjectSchemaEntry,
  bindMcpEntry(),
);

describe("@alpacaloop/channels MCP binding", () => {
  it("generates an exposed-parameter input schema and normalizes arguments", () => {
    const mcpEndpoint = createMcpEndpoint(TestEndpoint);
    const schema = mcpEndpoint.inputSchema;

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

    const result = mcpEndpoint.parse({
      symbol: ["AdapterContext"],
      internalOnly: "ignored channel input",
    });

    expect(result).toEqual({
      kind: ENTRY_DECODE_RESULT_KIND.resolved,
      projection: {
        symbol: ["AdapterContext"],
        depth: 2,
        verbose: false,
      },
    });
  });

  it("validates defaults through the shared decoder", () => {
    const entry = defineEntry({
      name: "invalid-default",
      parameters: [
        defineParameter({
          name: "count",
          codec: codecs.positiveInteger(),
          requirement: optional({ default: 0 }),
          description: "Count",
        }),
      ],
      project: ({ values }) => values,
    });
    const endpoint = defineEntryEndpoint(entry, bindMcpEntry("count"));

    expect(createMcpEndpoint(endpoint).parse({})).toMatchObject({
      kind: ENTRY_DECODE_RESULT_KIND.invalidParameter,
      parameterName: "count",
    });
  });

  it("separates explicit input errors from unexpected projection failures", () => {
    const endpointFor = (project: () => unknown) =>
      defineEntryEndpoint(
        defineEntry({ name: "error", parameters: [], project }),
        bindMcpEntry(),
      );
    const internalError = new Error("domain bug");

    expect(
      createMcpEndpoint(
        endpointFor(() => {
          throw new EntryInputError(["not allowed"]);
        }),
      ).parse({}),
    ).toMatchObject({
      kind: ENTRY_DECODE_RESULT_KIND.invalidInput,
      issues: ["not allowed"],
    });
    const internalResult = createMcpEndpoint(
      endpointFor(() => {
        throw internalError;
      }),
    ).parse({});
    expect(internalResult).toMatchObject({
      kind: ENTRY_DECODE_RESULT_KIND.internalError,
    });
    if (internalResult.kind === ENTRY_DECODE_RESULT_KIND.internalError) {
      expect(internalResult.error).toBe(internalError);
    }
  });
});

describe("@alpacaloop/channels output contract", () => {
  it("infers and verifies a declared output", () => {
    const output = verifyEntryOutput(TestOutputEntry, {
      status: "ok",
      count: 2,
    });

    expectTypeOf(output).toEqualTypeOf<TestOutput>();
    expectTypeOf(TestOutputEntry).toMatchTypeOf<
      EntryDefinitionWithOutput<string, readonly [], null, TestOutput>
    >();
    expectTypeOf(OutputlessEntry).not.toMatchTypeOf<
      EntryDefinitionWithOutput<
        string,
        readonly [],
        null,
        { readonly status: "ok" }
      >
    >();
    expectTypeOf<
      Extract<
        EntryDefinition<"output", readonly [], null, TestOutput>,
        { readonly output: OutputContract<TestOutput> }
      >
    >().toEqualTypeOf<
      EntryDefinitionWithOutput<"output", readonly [], null, TestOutput>
    >();
    expectTypeOf<{ readonly output: null }>().not.toMatchTypeOf<
      Pick<EntryDefinitionInput<"outputless", readonly [], null>, "output">
    >();
    expect(output).toEqual({ status: "ok", count: 2 });
  });

  it("normalizes an omitted output contract to null", () => {
    expect(Object.hasOwn(OutputlessEntry, "output")).toBe(true);
    expect(OutputlessEntry.output).toBeNull();
  });

  it.each([
    [{ status: "ok" }, "count"],
    [{ status: "ok", count: "two" }, "count"],
    [{ status: "ok", count: 2, extra: true }, "$"],
  ])("rejects invalid output %#", (value, issuePath) => {
    try {
      verifyEntryOutput(TestOutputEntry, value as unknown as TestOutput);
      throw new Error("Expected output verification to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EntryOutputContractError);
      if (!(error instanceof EntryOutputContractError)) {
        return;
      }
      expect(error.entryName).toBe(TestOutputEntry.name);
      expect(error.issues.some((issue) => issue.startsWith(issuePath))).toBe(
        true,
      );
    }
  });

  it("exposes a strict MCP output schema", () => {
    const schema = createMcpOutputSchema(TestOutputEndpoint);

    expectTypeOf(schema).toEqualTypeOf<z.ZodType<TestOutput>>();
    expect(schema).toBe(TestOutputSchema.unwrap());
    expect(z.toJSONSchema(schema)).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["status", "count"],
    });
  });

  it("rejects output access for an entry without an output contract", () => {
    expect(() => requireEntryOutput(OutputlessEntry)).toThrow(
      "Entry outputless does not declare an output contract",
    );
  });

  it("rejects an MCP output contract whose top-level schema is not an object", () => {
    expect(() => createMcpOutputSchema(NonObjectSchemaEndpoint)).toThrow(
      "Entry non-object-schema output contract must use a Zod object schema",
    );
  });
});
