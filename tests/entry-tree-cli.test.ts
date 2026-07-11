import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bindCliEntry,
  CLI_ROUTER_RESULT_KIND,
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
  EntryInputError,
  optional,
  required,
} from "../src/index.js";
import { bindMcpEntry, createMcpInputSchema } from "../src/mcp.js";

const DefaultEntry = defineEntry({
  name: "default",
  parameters: [
    defineParameter({
      name: "verbose",
      codec: codecs.boolean(),
      requirement: optional({ default: false }),
      description: "Verbose output",
    }),
  ],
  project: ({ values }) => ({ command: "default", ...values }),
});

const HintEntry = defineEntry({
  name: "hint",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Hint query",
    }),
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
  project: ({ values }) => ({ command: "hint", ...values }),
});

const HintMcpBinding = {
  parameters: [
    { parameterName: "query" },
    { parameterName: "tag" },
    { parameterName: "verbose" },
  ],
} as const;

const HintEndpoint = defineEntryEndpoint(
  HintEntry,
  bindCliEntry({
    parameters: [
      {
        kind: "option",
        parameterName: "query",
        flags: ["--query", "-q"],
      },
      {
        kind: "option",
        parameterName: "tag",
        flags: ["--tag"],
        repeatMode: "comma_or_repeat",
      },
      {
        kind: "option",
        parameterName: "verbose",
        flags: ["--verbose"],
        negated: true,
      },
    ],
  }),
  bindMcpEntry(HintMcpBinding),
);

const CollectEntry = defineEntry({
  name: "collect",
  parameters: [
    defineParameter({
      name: "head",
      codec: codecs.string(),
      requirement: required(),
      description: "First value",
    }),
    defineParameter({
      name: "tail",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Remaining values",
    }),
  ],
  project: ({ values }) => values,
});

function createAcceptanceTree() {
  const deepEntry = defineEntry({
    name: "deep",
    parameters: [],
    project: () => "deepest",
  });
  return defineEntryTree(
    defineEntryNode({
      name: "alpaca",
      description: "Root",
      endpoints: [
        defineEntryEndpoint(
          DefaultEntry,
          bindCliEntry({
            parameters: [
              {
                kind: "option",
                parameterName: "verbose",
                flags: ["--verbose"],
                negated: true,
              },
            ],
          }),
        ),
      ],
      children: [
        defineEntryNode({
          name: "hint",
          description: "Find hints",
          segments: [overrideCliSegment({ token: "h", aliases: ["hi"] })],
          endpoints: [HintEndpoint],
          children: [
            defineEntryNode({
              name: "show",
              description: "Show hint details",
              endpoints: [
                defineEntryEndpoint(
                  deepEntry,
                  bindCliEntry({ parameters: [] }),
                ),
              ],
            }),
          ],
        }),
        defineEntryNode({
          name: "collect",
          description: "Collect values",
          endpoints: [
            defineEntryEndpoint(
              CollectEntry,
              bindCliEntry({
                parameters: [
                  {
                    kind: "positional",
                    parameterName: "head",
                    valueName: "HEAD",
                    variadic: false,
                  },
                  {
                    kind: "positional",
                    parameterName: "tail",
                    valueName: "TAIL",
                    variadic: true,
                  },
                ],
              }),
            ),
          ],
        }),
        defineEntryNode({
          name: "one",
          description: "Level one",
          children: [
            defineEntryNode({
              name: "two",
              description: "Level two",
              children: [
                defineEntryNode({
                  name: "three",
                  description: "Level three",
                  children: [
                    defineEntryNode({
                      name: "four",
                      description: "Level four",
                      endpoints: [
                        defineEntryEndpoint(
                          deepEntry,
                          bindCliEntry({ parameters: [] }),
                        ),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  );
}

describe("CLI entry tree router", () => {
  it("narrows only the resolved endpoint with matching identity", () => {
    const router = createCliRouter(
      defineEntryTree(
        defineEntryNode({
          name: "hint",
          description: "Hint",
          endpoints: [HintEndpoint],
        }),
      ),
    );
    const otherEndpoint = defineEntryEndpoint(
      HintEntry,
      bindCliEntry({
        parameters: [
          { kind: "option", parameterName: "query", flags: ["--query"] },
          { kind: "option", parameterName: "tag", flags: ["--tag"] },
          { kind: "option", parameterName: "verbose", flags: ["--verbose"] },
        ],
      }),
    );
    const result = router.resolve(["--query", "value"]);

    expect(isCliResolvedEndpoint(result, HintEndpoint)).toBe(true);
    expect(isCliResolvedEndpoint(result, otherEndpoint)).toBe(false);
  });

  it("resolves the root default, overrides, aliases, options, repeats and negation", () => {
    const router = createCliRouter(createAcceptanceTree());
    expect(router.resolve([])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: { command: "default", verbose: false },
    });

    expect(
      router.resolve([
        "hi",
        "-q",
        "symbol",
        "--tag",
        "core,cli",
        "--tag=runtime",
        "--verbose",
        "--no-verbose",
      ]),
    ).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: {
        command: "hint",
        query: "symbol",
        tag: ["core", "cli", "runtime"],
        verbose: false,
      },
    });
    const hintHelp = router.help.children.find(
      (child) => child.name === "hint",
    );
    const verboseHelp = hintHelp?.options.find(
      (option) => option.parameterName === "verbose",
    );
    expect(verboseHelp?.negativeFlags).toEqual(["--no-verbose"]);
  });

  it("uses the deepest command match and supports a four-level tree", () => {
    const router = createCliRouter(createAcceptanceTree());
    expect(router.resolve(["h", "show"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: "deepest",
    });
    expect(router.resolve(["one", "two", "three", "four"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: "deepest",
    });
  });

  it("parses positional and final variadic arguments, including values after --", () => {
    const result = createCliRouter(createAcceptanceTree()).resolve([
      "collect",
      "--",
      "--literal",
      "two",
      "three",
    ]);
    expect(result).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: { head: "--literal", tail: ["two", "three"] },
    });
  });

  it("allows an array codec to consume one non-variadic positional", () => {
    const entry = defineEntry({
      name: "single-list",
      parameters: [
        defineParameter({
          name: "item",
          codec: codecs.stringList(),
          requirement: required(),
          description: "One item",
        }),
      ],
      project: ({ values }) => values,
    });
    const router = createCliRouter(
      defineEntryTree(
        defineEntryNode({
          name: "root",
          description: "Root",
          endpoints: [
            defineEntryEndpoint(
              entry,
              bindCliEntry({
                parameters: [
                  {
                    kind: "positional",
                    parameterName: "item",
                    valueName: "ITEM",
                    variadic: false,
                  },
                ],
              }),
            ),
          ],
        }),
      ),
    );

    expect(router.resolve(["value"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: { item: ["value"] },
    });
  });

  it("projects option and positional defaults into the help surface", () => {
    const entry = defineEntry({
      name: "defaults",
      parameters: [
        defineParameter({
          name: "text",
          codec: codecs.string(),
          requirement: optional({ default: "value" }),
          description: "Text",
        }),
        defineParameter({
          name: "count",
          codec: codecs.positiveInteger(),
          requirement: optional({ default: 2 }),
          description: "Count",
        }),
        defineParameter({
          name: "enabled",
          codec: codecs.boolean(),
          requirement: optional({ default: false }),
          description: "Enabled",
        }),
        defineParameter({
          name: "tags",
          codec: codecs.stringList(),
          requirement: optional({ default: ["core"] }),
          description: "Tags",
        }),
        defineParameter({
          name: "target",
          codec: codecs.string(),
          requirement: optional({ default: "src" }),
          description: "Target",
        }),
      ],
      project: ({ values }) => values,
    });
    const router = createCliRouter(
      defineEntryTree(
        defineEntryNode({
          name: "defaults",
          description: "Defaults",
          endpoints: [
            defineEntryEndpoint(
              entry,
              bindCliEntry({
                parameters: [
                  { kind: "option", parameterName: "text", flags: ["--text"] },
                  {
                    kind: "option",
                    parameterName: "count",
                    flags: ["--count"],
                  },
                  {
                    kind: "option",
                    parameterName: "enabled",
                    flags: ["--enabled"],
                  },
                  { kind: "option", parameterName: "tags", flags: ["--tag"] },
                  {
                    kind: "positional",
                    parameterName: "target",
                    valueName: "target",
                    variadic: false,
                  },
                ],
              }),
            ),
          ],
        }),
      ),
    );

    expect(
      Object.fromEntries(
        router.help.options.map((option) => [
          option.parameterName,
          option.defaultValue,
        ]),
      ),
    ).toEqual({ text: "value", count: 2, enabled: false, tags: ["core"] });
    expect(router.help.positionals[0]?.defaultValue).toBe("src");
  });

  it("builds help for a deeply nested tree without recursion", () => {
    const entry = defineEntry({
      name: "leaf",
      parameters: [],
      project: () => null,
    });
    let root = defineEntryNode({
      name: "leaf",
      description: "Leaf",
      endpoints: [defineEntryEndpoint(entry, bindCliEntry({ parameters: [] }))],
    });
    for (let depth = 0; depth < 3_000; depth += 1) {
      root = defineEntryNode({
        name: `level-${depth}`,
        description: "Level",
        children: [root],
      });
    }

    expect(createCliRouter(defineEntryTree(root)).help.name).toBe("level-2999");
  });

  it("reports required input and exposes a derived help surface", () => {
    const router = createCliRouter(createAcceptanceTree());
    expect(router.resolve(["h"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.invalidInput,
      parameterName: "query",
    });
    expect(router.help).toMatchObject({
      name: "alpaca",
      token: null,
      executable: true,
      children: expect.arrayContaining([
        expect.objectContaining({
          name: "hint",
          token: "h",
          aliases: ["hi"],
          executable: true,
        }),
      ]),
    });
  });

  it("distinguishes unknown and incomplete commands", () => {
    const router = createCliRouter(createAcceptanceTree());
    expect(router.resolve(["unknown"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.unknownCommand,
      token: "unknown",
    });
    const groupTree = defineEntryTree(
      defineEntryNode({
        name: "root",
        description: "Root",
        children: [
          defineEntryNode({
            name: "group",
            description: "Group",
            children: [
              defineEntryNode({
                name: "leaf",
                description: "Leaf",
                endpoints: [
                  defineEntryEndpoint(
                    defineEntry({
                      name: "leaf",
                      parameters: [],
                      project: () => null,
                    }),
                    bindCliEntry({ parameters: [] }),
                  ),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(createCliRouter(groupTree).resolve(["group"])).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.incompleteCommand,
    });
  });
});

describe("one endpoint definition drives CLI and MCP", () => {
  it("parses argv and projects the same endpoint's MCP input schema", () => {
    const tree = defineEntryTree(
      defineEntryNode({
        name: "hint",
        description: "Hint",
        endpoints: [HintEndpoint],
      }),
    );
    expect(
      createCliRouter(tree).resolve(["--query", "AdapterContext"]),
    ).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.resolved,
      projection: { command: "hint", query: "AdapterContext", verbose: false },
    });

    const endpoint = tree.root.endpoints[0];
    expect(endpoint).toBeDefined();
    if (!endpoint) {
      return;
    }
    const shape = createMcpInputSchema({ endpoint });
    expect(Object.keys(shape).sort()).toEqual(["query", "tag", "verbose"]);
    expect(z.object(shape).safeParse({ query: "AdapterContext" }).success).toBe(
      true,
    );
    expect(z.object(shape).safeParse({}).success).toBe(false);
  });
});

describe("CLI decoder error classes", () => {
  it("keeps codec and explicit input errors separate from domain bugs", () => {
    const entryFor = (project: () => unknown) =>
      defineEntry({
        name: "error",
        parameters: [
          defineParameter({
            name: "count",
            codec: codecs.positiveInteger(),
            requirement: required(),
            description: "Count",
          }),
        ],
        project,
      });
    const resolve = (project: () => unknown, value: string) =>
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "error",
            description: "Error",
            endpoints: [
              defineEntryEndpoint(
                entryFor(project),
                bindCliEntry({
                  parameters: [
                    {
                      kind: "option",
                      parameterName: "count",
                      flags: ["--count"],
                    },
                  ],
                }),
              ),
            ],
          }),
        ),
      ).resolve(["--count", value]);

    expect(resolve(() => null, "zero")).toMatchObject({
      kind: CLI_ROUTER_RESULT_KIND.invalidInput,
      parameterName: "count",
    });
    expect(
      resolve(() => {
        throw new EntryInputError(["not allowed"]);
      }, "1"),
    ).toMatchObject({ kind: CLI_ROUTER_RESULT_KIND.invalidInput });
    expect(
      resolve(() => {
        throw new Error("domain bug");
      }, "1"),
    ).toMatchObject({ kind: CLI_ROUTER_RESULT_KIND.internalError });
  });
});
