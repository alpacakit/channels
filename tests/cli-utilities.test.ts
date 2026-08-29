import {
  CODEC_DECODE_RESULT_KIND,
  type JsonValue,
  jsonValueSchema,
} from "@alpacakit/core";
import { describe, expect, it } from "vitest";
import {
  bindCliEntry,
  CLI_ARG_KIND,
  CLI_OPTION_KIND,
  CLI_ROUTER_RESULT_KIND,
  CLI_VALUE_COERCION,
  CliExecutorDefinitionError,
  createCliExecutor,
  createCliRouter,
  findCliHelpSurface,
  formatCliRouterError,
  handleCliEndpoint,
  overrideCliSegment,
  renderCliHelp,
} from "../src/cli.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  ENTRY_INPUT_TARGET_KIND,
  EntryInputError,
  mergeEntryTreeNodes,
  optional,
  required,
  type ValueCodec,
} from "../src/index.js";

const CountEntry = defineEntry({
  name: "count",
  parameters: [
    defineParameter({
      name: "generation",
      codec: codecs.positiveInteger(),
      requirement: required(),
      description: "Generation",
    }),
  ],
  project: ({ values }) => values.generation,
});

const CountEndpoint = defineEntryEndpoint(
  CountEntry,
  bindCliEntry({
    parameters: [
      {
        kind: CLI_ARG_KIND.option,
        parameterName: "generation",
        flags: ["--generation"],
        valueName: "count",
      },
    ],
  }),
);

function createCountRouter() {
  return createCliRouter(
    defineEntryTree(
      defineEntryNode({
        name: "tool",
        description: "Tool",
        children: [
          defineEntryNode({
            name: "generate",
            description: "Generate output",
            segments: [overrideCliSegment({ token: "generate" })],
            endpoints: [CountEndpoint],
          }),
        ],
      }),
    ),
  );
}

describe("CLI utility APIs", () => {
  it("coerces every integer syntax before validating its range", () => {
    const router = createCountRouter();
    for (const value of ["0", "-1"]) {
      const result = router.resolve(["generate", "--generation", value]);
      expect(result).toMatchObject({
        kind: CLI_ROUTER_RESULT_KIND.invalidParameter,
        parameterName: "generation",
      });
      if (result.kind === CLI_ROUTER_RESULT_KIND.invalidParameter) {
        expect(result.issues.join(" ")).not.toContain("received string");
      }
    }
    expect(router.resolve(["generate", "--generation", "+01"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: 1,
    });
  });

  it("renders option value names and locates only canonical help surfaces", () => {
    const router = createCountRouter();
    expect(findCliHelpSurface(router.help, ["g"])).toBeNull();
    const surface = findCliHelpSurface(router.help, ["generate"]);
    expect(surface).not.toBeNull();
    if (!surface) {
      return;
    }
    const option = surface.optionGroups.flatMap((group) => group.options)[0];
    expect(option?.kind).toBe(CLI_OPTION_KIND.value);
    if (option?.kind === CLI_OPTION_KIND.value) {
      expect(option.valueName).toBe("count");
    }
    expect(
      renderCliHelp(surface, {
        executableName: "tool",
        programName: "tool generate",
        path: ["generate"],
        withDescription: false,
      }),
    ).toContain("--generation <count>");
  });

  it("renders negated and repeatable option forms", () => {
    const entry = defineEntry({
      name: "filter",
      parameters: [
        defineParameter({
          name: "tag",
          codec: codecs.stringList(),
          requirement: optional(),
          description: "Tag filters",
        }),
        defineParameter({
          name: "verbose",
          codec: codecs.boolean(),
          requirement: optional({ default: false }),
          description: "Verbose output",
        }),
      ],
      project: ({ values }) => values,
    });
    const router = createCliRouter(
      defineEntryTree(
        defineEntryNode({
          name: "filter",
          description: "Filter output",
          endpoints: [
            defineEntryEndpoint(
              entry,
              bindCliEntry({
                parameters: [
                  {
                    kind: CLI_ARG_KIND.option,
                    parameterName: "tag",
                    repeatMode: "comma_or_repeat",
                  },
                  {
                    kind: CLI_ARG_KIND.option,
                    parameterName: "verbose",
                    negated: true,
                  },
                ],
              }),
            ),
          ],
        }),
      ),
    );
    const help = renderCliHelp(router.help, {
      executableName: "tool",
      programName: "tool",
      path: [],
      withDescription: false,
    });
    expect(help).toContain("--verbose, --no-verbose");
    expect(help).toContain("comma-separated or repeatable");
    // Terminating the output is the renderer's job: every caller writes this
    // to a terminal, and none of them should have to append the newline.
    expect(help.endsWith("\n")).toBe(true);
    expect(help.endsWith("\n\n")).toBe(false);
  });

  it("formats router failures", () => {
    const result = createCountRouter().resolve(["missing"]);
    expect(result.kind).toBe(CLI_ROUTER_RESULT_KIND.unknownCommand);
    if (result.kind !== CLI_ROUTER_RESULT_KIND.unknownCommand) {
      return;
    }
    expect(formatCliRouterError(result)).toContain("Unknown command");

    const invalidInput = createCountRouter().resolve(["generate", "--missing"]);
    expect(invalidInput.kind).toBe(CLI_ROUTER_RESULT_KIND.invalidInput);
    if (invalidInput.kind === CLI_ROUTER_RESULT_KIND.invalidInput) {
      expect(formatCliRouterError(invalidInput)).toContain("Invalid input:");
    }

    const invalidParameter = createCountRouter().resolve([
      "generate",
      "--generation",
    ]);
    expect(invalidParameter.kind).toBe(CLI_ROUTER_RESULT_KIND.invalidParameter);
    if (invalidParameter.kind === CLI_ROUTER_RESULT_KIND.invalidParameter) {
      expect(formatCliRouterError(invalidParameter)).toContain(
        "Invalid generation:",
      );
    }
  });

  it.each([
    "boolean",
    "VERBOSE",
  ])("rejects an authored valueName (%s) on boolean flag options", (valueName) => {
    const entry = defineEntry({
      name: "verbose",
      parameters: [
        defineParameter({
          name: "verbose",
          codec: codecs.boolean(),
          requirement: optional({ default: false }),
          description: "Verbose",
        }),
      ],
      project: ({ values }) => values,
    });
    expect(() =>
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "verbose",
            description: "Verbose",
            endpoints: [
              defineEntryEndpoint(
                entry,
                bindCliEntry({
                  parameters: [
                    {
                      kind: CLI_ARG_KIND.option,
                      parameterName: "verbose",
                      valueName,
                    },
                  ],
                }),
              ),
            ],
          }),
        ),
      ),
    ).toThrow("valueName contradicts flag booleanMode");
  });

  it("dispatches a resolved endpoint with its typed projection", async () => {
    const router = createCountRouter();
    const executor = createCliExecutor(router, [
      handleCliEndpoint(
        CountEndpoint,
        ({ projection }) => `generation=${projection}`,
      ),
    ]);
    const result = router.resolve(["generate", "--generation", "2"]);
    expect(result.kind).toBe(CLI_ROUTER_RESULT_KIND.resolved);
    if (result.kind !== CLI_ROUTER_RESULT_KIND.resolved) {
      return;
    }
    expect(await executor.execute(result)).toBe("generation=2");
  });

  it("rejects incomplete executor registries", () => {
    expect(() => createCliExecutor(createCountRouter(), [])).toThrow(
      CliExecutorDefinitionError,
    );
  });

  it("rejects duplicate and out-of-router executor registrations", () => {
    const handler = handleCliEndpoint(CountEndpoint, ({ projection }) =>
      String(projection),
    );
    expect(() =>
      createCliExecutor(createCountRouter(), [handler, handler]),
    ).toThrow(CliExecutorDefinitionError);

    const otherEndpoint = defineEntryEndpoint(
      CountEntry,
      bindCliEntry({
        parameters: [
          { kind: CLI_ARG_KIND.option, parameterName: "generation" },
        ],
      }),
    );
    expect(() =>
      createCliExecutor(createCountRouter(), [
        handleCliEndpoint(otherEndpoint, ({ projection }) => projection),
      ]),
    ).toThrow(CliExecutorDefinitionError);
  });
});

describe("CLI JSON coercion", () => {
  const jsonCodec: ValueCodec<JsonValue> = {
    schema: jsonValueSchema,
    shape: { kind: "string" },
    decode: (input) => {
      const parsed = jsonValueSchema.safeParse(input);
      return parsed.success
        ? { kind: CODEC_DECODE_RESULT_KIND.decoded, value: parsed.data }
        : {
            kind: CODEC_DECODE_RESULT_KIND.invalid,
            issues: ["Expected JSON"],
          };
    },
    encode: (value) => value,
  };

  function resolve(coercion: "json" | "json_or_string", value: string) {
    const entry = defineEntry({
      name: "json",
      parameters: [
        defineParameter({
          name: "value",
          codec: jsonCodec,
          requirement: required(),
          description: "JSON value",
        }),
      ],
      project: ({ values }) => values.value,
    });
    return createCliRouter(
      defineEntryTree(
        defineEntryNode({
          name: "json",
          description: "JSON",
          endpoints: [
            defineEntryEndpoint(
              entry,
              bindCliEntry({
                parameters: [
                  {
                    kind: CLI_ARG_KIND.option,
                    parameterName: "value",
                    coercion,
                  },
                ],
              }),
            ),
          ],
        }),
      ),
    ).resolve(["--value", value]);
  }

  it("parses strict JSON and reports malformed input", () => {
    expect(resolve(CLI_VALUE_COERCION.json, '{"ok":true}')).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: { ok: true },
    });
    expect(resolve(CLI_VALUE_COERCION.json, "plain")).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.invalidParameter,
      parameterName: "value",
    });
  });

  it("keeps non-JSON text in json_or_string mode", () => {
    expect(resolve(CLI_VALUE_COERCION.jsonOrString, "plain")).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: "plain",
    });
  });
});

describe("entry tree composition and projection errors", () => {
  it("merges canonical nodes recursively and deduplicates endpoint identity", () => {
    const nodes = mergeEntryTreeNodes([
      defineEntryNode({
        name: "config",
        description: "Config commands",
        children: [
          defineEntryNode({
            name: "set",
            description: "Set config",
            endpoints: [CountEndpoint],
          }),
        ],
      }),
      defineEntryNode({
        name: "config",
        description: "Config commands",
        children: [
          defineEntryNode({
            name: "set",
            description: "Set config",
            endpoints: [CountEndpoint],
          }),
        ],
      }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children[0]?.endpoints).toEqual([CountEndpoint]);
  });

  it("rejects conflicting canonical node metadata", () => {
    expect(() =>
      mergeEntryTreeNodes([
        defineEntryNode({ name: "config", description: "First" }),
        defineEntryNode({ name: "config", description: "Second" }),
      ]),
    ).toThrow("conflicting node descriptions");

    expect(() =>
      mergeEntryTreeNodes([
        defineEntryNode({
          name: "config",
          description: "Config",
          segments: [overrideCliSegment({ token: "config" })],
        }),
        defineEntryNode({
          name: "config",
          description: "Config",
          segments: [overrideCliSegment({ token: "settings" })],
        }),
      ]),
    ).toThrow("conflicting cli segment overrides");
  });

  it("merges equivalent segment payloads with different key order", () => {
    const ordered = overrideCliSegment({ token: "config" });
    const payload = ordered.segment as {
      readonly token: string;
      readonly help: unknown;
    };
    const reverseOrdered = {
      ...ordered,
      segment: {
        help: payload.help,
        token: payload.token,
      },
    } as typeof ordered;

    const [merged] = mergeEntryTreeNodes([
      defineEntryNode({
        name: "config",
        description: "Config",
        segments: [ordered],
      }),
      defineEntryNode({
        name: "config",
        description: "Config",
        segments: [reverseOrdered],
      }),
    ]);

    expect(merged?.segments).toHaveLength(1);
  });

  it("treats empty documentation as no merge claim", () => {
    const documentation = {
      relatedDocs: ["config"],
      remarks: ["Shared guidance."],
    };
    const [merged] = mergeEntryTreeNodes([
      defineEntryNode({ name: "config", description: "Config" }),
      defineEntryNode({
        name: "config",
        description: "Config",
        documentation,
      }),
      defineEntryNode({
        name: "config",
        description: "Config",
        documentation: {
          remarks: ["Shared guidance."],
          relatedDocs: ["config"],
        },
      }),
    ]);

    expect(merged?.documentation).toEqual(documentation);
    expect(
      defineEntryNode({
        name: "partial",
        description: "Partial",
        documentation: { remarks: ["Remark"] },
      }).documentation,
    ).toEqual({ remarks: ["Remark"], relatedDocs: [] });
  });

  it("rejects only differing non-empty documentation claims", () => {
    expect(() =>
      mergeEntryTreeNodes([
        defineEntryNode({
          name: "config",
          description: "Config",
          documentation: { remarks: ["First"] },
        }),
        defineEntryNode({
          name: "config",
          description: "Config",
          documentation: { remarks: ["Second"] },
        }),
      ]),
    ).toThrow("conflicting node documentation");

    expect(() =>
      mergeEntryTreeNodes([
        defineEntryNode({
          name: "config",
          description: "Config",
          documentation: { remarks: ["First", "Second"] },
        }),
        defineEntryNode({
          name: "config",
          description: "Config",
          documentation: { remarks: ["Second", "First"] },
        }),
      ]),
    ).toThrow("conflicting node documentation");
  });

  it("merges deeply nested trees without recursive stack growth", () => {
    let node = defineEntryNode({ name: "leaf", description: "Leaf" });
    for (let depth = 0; depth < 3_000; depth += 1) {
      node = defineEntryNode({
        name: `node-${depth}`,
        description: `Node ${depth}`,
        children: [node],
      });
    }
    const merged = mergeEntryTreeNodes([node]);
    let current = merged[0];
    let depth = 0;
    while (current?.children[0]) {
      current = current.children[0];
      depth += 1;
    }
    expect(depth).toBe(3_000);
  });

  it("carries a valid EntryInputError parameter and rejects an unknown one", () => {
    const resolve = (parameterName: string) => {
      const entry = defineEntry({
        name: CountEntry.name,
        parameters: CountEntry.parameters,
        project: () => {
          throw new EntryInputError(["invalid combination"], {
            kind: ENTRY_INPUT_TARGET_KIND.parameter,
            parameterName,
          });
        },
      });
      return createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "count",
            description: "Count",
            endpoints: [
              defineEntryEndpoint(
                entry,
                bindCliEntry({
                  parameters: [
                    { kind: CLI_ARG_KIND.option, parameterName: "generation" },
                  ],
                }),
              ),
            ],
          }),
        ),
      ).resolve(["--generation", "1"]);
    };
    expect(resolve("generation")).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.invalidParameter,
      parameterName: "generation",
    });
    expect(resolve("missing")).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.internalError,
    });
  });
});
