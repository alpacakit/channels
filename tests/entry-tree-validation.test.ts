import { describe, expect, it } from "vitest";
import {
  bindCliEntry,
  createCliRouter,
  overrideCliSegment,
} from "../src/cli.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryDefinition,
  EntryTreeDefinitionError,
  optional,
  type ParameterSet,
  required,
} from "../src/index.js";
import { bindMcpEntry, createMcpInputSchema } from "../src/mcp.js";

const RequiredEntry = defineEntry({
  name: "required",
  parameters: [
    defineParameter({
      name: "value",
      codec: codecs.string(),
      requirement: required(),
      description: "Value",
    }),
  ],
  project: ({ values }) => values,
});

const ShapeEntry = defineEntry({
  name: "shapes",
  parameters: [
    defineParameter({
      name: "text",
      codec: codecs.string(),
      requirement: optional(),
      description: "Text",
    }),
    defineParameter({
      name: "flag",
      codec: codecs.boolean(),
      requirement: optional({ default: false }),
      description: "Flag",
    }),
    defineParameter({
      name: "list",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "List",
    }),
  ],
  project: ({ values }) => values,
});

const EmptyEntry = defineEntry({
  name: "empty",
  parameters: [],
  project: () => null,
});
const emptyEndpoint = () =>
  defineEntryEndpoint(EmptyEntry, bindCliEntry({ parameters: [] }));
const node = (input: Parameters<typeof defineEntryNode>[0]) =>
  defineEntryNode(input);
const expectInvalid = (
  root: ReturnType<typeof defineEntryNode>,
  issue: string,
) => {
  try {
    createCliRouter(defineEntryTree(root));
    throw new Error("Expected entry tree validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EntryTreeDefinitionError);
    if (error instanceof EntryTreeDefinitionError) {
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.stringContaining(issue)]),
      );
    }
  }
};

describe("Phase-A entry tree definition validation", () => {
  it("rejects empty names and duplicate sibling logical names", () => {
    expectInvalid(
      node({ name: "", description: "Root", endpoints: [emptyEndpoint()] }),
      "name",
    );
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        children: [
          node({
            name: "same",
            description: "One",
            endpoints: [emptyEndpoint()],
          }),
          node({
            name: "same",
            description: "Two",
            endpoints: [emptyEndpoint()],
          }),
        ],
      }),
      "duplicate child name",
    );
  });

  it("rejects duplicate overrides and CLI sibling token or alias collisions", () => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        segments: [
          overrideCliSegment({ token: "one", aliases: [] }),
          overrideCliSegment({ token: "two", aliases: [] }),
        ],
        endpoints: [emptyEndpoint()],
      }),
      "duplicate cli segment override",
    );
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        children: [
          node({
            name: "one",
            description: "One",
            segments: [overrideCliSegment({ token: "first", aliases: ["x"] })],
            endpoints: [emptyEndpoint()],
          }),
          node({
            name: "two",
            description: "Two",
            segments: [overrideCliSegment({ token: "x", aliases: [] })],
            endpoints: [emptyEndpoint()],
          }),
        ],
      }),
      "sibling token/alias collision",
    );
  });

  it.each([
    "query",
    "-",
    "--",
    "---query",
    "--query=value",
    "--bad flag",
  ])("rejects unreachable CLI option flag %j", (flag) => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(
            RequiredEntry,
            bindCliEntry({
              parameters: [
                {
                  kind: "option",
                  parameterName: "value",
                  flags: [flag as `-${string}`],
                },
              ],
            }),
          ),
        ],
      }),
      "unreachable CLI flag",
    );
  });

  it.each([
    { token: "", aliases: [] },
    { token: "-hidden", aliases: [] },
    { token: "child", aliases: ["--hidden"] },
  ])("rejects unreachable CLI child segment %#", (segment) => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        children: [
          node({
            name: "child",
            description: "Child",
            segments: [overrideCliSegment(segment)],
            endpoints: [emptyEndpoint()],
          }),
        ],
      }),
      segment.token.length === 0 ? "must not be empty" : "unreachable",
    );
  });

  it("rejects an unreachable default CLI child segment", () => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        children: [
          node({
            name: "-child",
            description: "Child",
            endpoints: [emptyEndpoint()],
          }),
        ],
      }),
      "unreachable",
    );
  });

  it("rejects multiple CLI endpoints and duplicate channel bindings", () => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [emptyEndpoint(), emptyEndpoint()],
      }),
      "more than one public CLI endpoint",
    );
    const cli = bindCliEntry({ parameters: [] });
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [defineEntryEndpoint(EmptyEntry, cli, cli)],
      }),
      "duplicate cli channel binding",
    );
  });

  it("rejects an executable positional node with children and non-final variadics", () => {
    const positionalEndpoint = defineEntryEndpoint(
      ShapeEntry,
      bindCliEntry({
        parameters: [
          {
            kind: "positional",
            parameterName: "list",
            valueName: "LIST",
            variadic: true,
          },
          {
            kind: "positional",
            parameterName: "text",
            valueName: "TEXT",
            variadic: false,
          },
        ],
      }),
    );
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [positionalEndpoint],
        children: [
          node({
            name: "child",
            description: "Child",
            endpoints: [emptyEndpoint()],
          }),
        ],
      }),
      "both positionals and children",
    );
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [positionalEndpoint],
      }),
      "must be last",
    );
  });

  it.each([
    [
      {
        kind: "option",
        parameterName: "text",
        flags: ["--text"],
        booleanMode: "flag",
      },
      "booleanMode contradicts",
    ],
    [
      {
        kind: "option",
        parameterName: "text",
        flags: ["--text"],
        negated: true,
      },
      "negated contradicts",
    ],
    [
      {
        kind: "option",
        parameterName: "text",
        flags: ["--text"],
        repeatMode: "comma_or_repeat",
      },
      "repeatMode contradicts",
    ],
  ] as const)("rejects codec-shape mismatch %#", (binding, issue) => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(
            ShapeEntry,
            bindCliEntry({ parameters: [binding] }),
          ),
        ],
      }),
      issue,
    );
  });

  it("rejects duplicate, nonexistent and unreachable parameter bindings", () => {
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(
            RequiredEntry,
            bindCliEntry({
              parameters: [
                { kind: "option", parameterName: "value", flags: ["--one"] },
                { kind: "option", parameterName: "value", flags: ["--two"] },
              ],
            }),
          ),
        ],
      }),
      "duplicate binding for parameter",
    );

    const erasedEntry = RequiredEntry as unknown as EntryDefinition<
      string,
      ParameterSet,
      unknown
    >;
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(
            erasedEntry,
            bindCliEntry({
              parameters: [
                {
                  kind: "option",
                  parameterName: "missing",
                  flags: ["--missing"],
                },
              ],
            }),
          ),
        ],
      }),
      "nonexistent parameter",
    );
    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(RequiredEntry, bindCliEntry({ parameters: [] })),
        ],
      }),
      "required parameter value is unreachable",
    );
  });

  it("applies duplicate, nonexistent and required-reachability checks to MCP", () => {
    const duplicate = defineEntryEndpoint(
      RequiredEntry,
      bindMcpEntry("value", "value"),
    );
    expect(() => createMcpInputSchema({ endpoint: duplicate })).toThrow(
      "duplicate MCP binding",
    );

    const erasedEntry = RequiredEntry as unknown as EntryDefinition<
      string,
      ParameterSet,
      unknown
    >;
    const nonexistent = defineEntryEndpoint(
      erasedEntry,
      bindMcpEntry("missing"),
    );
    expect(() => createMcpInputSchema({ endpoint: nonexistent })).toThrow(
      "nonexistent parameter",
    );

    const unreachable = defineEntryEndpoint(RequiredEntry, bindMcpEntry());
    expect(() => createMcpInputSchema({ endpoint: unreachable })).toThrow(
      "required parameter value is unreachable from MCP",
    );
  });

  it("rejects collisions with generated negated option flags", () => {
    const entry = defineEntry({
      name: "negated-collision",
      parameters: [
        defineParameter({
          name: "feature",
          codec: codecs.boolean(),
          requirement: optional({ default: false }),
          description: "Feature",
        }),
        defineParameter({
          name: "target",
          codec: codecs.string(),
          requirement: required(),
          description: "Target",
        }),
      ],
      project: ({ values }) => values,
    });

    expectInvalid(
      node({
        name: "root",
        description: "Root",
        endpoints: [
          defineEntryEndpoint(
            entry,
            bindCliEntry({
              parameters: [
                {
                  kind: "option",
                  parameterName: "feature",
                  flags: ["--feature"],
                  negated: true,
                },
                {
                  kind: "option",
                  parameterName: "target",
                  flags: ["--no-feature"],
                },
              ],
            }),
          ),
        ],
      }),
      "duplicate CLI option flag --no-feature",
    );
  });
});
