import { describe, expect, it } from "vitest";
import {
  bindCliEntry,
  collectCliCommands,
  overrideCliSegment,
} from "../src/cli.js";
import {
  bindHttpEntry,
  collectHttpRoutes,
  overrideHttpSegment,
} from "../src/http.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  EntryTreeDefinitionError,
  type EntryTreeNode,
  mergeEntryTreeNodes,
  optional,
  required,
} from "../src/index.js";
import { bindMcpEntry, collectMcpTools } from "../src/mcp.js";

const EmptyEntry = defineEntry({
  name: "empty",
  parameters: [],
  project: () => ({ ok: true as const }),
});

function endpoint(name: string, method = "PROPFIND") {
  return defineEntryEndpoint(EmptyEntry, {
    handler: () => ({ name }),
    channels: [
      bindCliEntry({ parameters: [] }),
      bindHttpEntry({ method }),
      bindMcpEntry({ name }),
    ],
  });
}

describe("external host collectors", () => {
  it("keeps root execution, children, group metadata, and help", () => {
    const rootEndpoint = endpoint("root");
    const childEndpoint = endpoint("child");
    const tree = defineEntryTree(
      defineEntryNode({
        name: "program",
        description: "Program description",
        documentation: {
          remarks: ["Root remark"],
          relatedDocs: ["https://example.test/root"],
        },
        segments: [
          overrideCliSegment({
            token: "tool",
            help: {
              subcommandHint: "Choose a command",
              examples: [
                {
                  title: "Root example",
                  useWhen: "Checking help",
                  command: "tool child",
                },
              ],
            },
          }),
        ],
        endpoints: [rootEndpoint],
        children: [
          defineEntryNode({
            name: "child",
            description: "Child command",
            endpoints: [childEndpoint],
          }),
          defineEntryNode({
            name: "group",
            description: "Group only",
            documentation: { remarks: ["Still visible"] },
          }),
        ],
      }),
    );

    const cli = collectCliCommands(tree);
    expect(cli.root).toMatchObject({
      token: "tool",
      path: [],
      description: "Program description",
      documentation: { remarks: ["Root remark"] },
    });
    expect(cli.root.commands.length).toBe(1);
    expect(cli.root.children.map((child) => child.token)).toEqual([
      "child",
      "group",
    ]);
    expect(cli.root.children[1]?.commands.length).toBe(0);
    expect(cli.root.children[1]?.help.remarks).toEqual(["Still visible"]);
    expect(cli.root.help.examples[0]?.title).toBe("Root example");

    const paths: string[][] = [];
    cli.root.commands.forEach((command) => {
      paths.push([...command.path]);
    });
    cli.root.children[0]?.commands.forEach((command) => {
      paths.push([...command.path]);
    });
    expect(paths).toEqual([[], ["child"]]);
  });

  it("distinguishes Tree roots from directly collected Nodes", () => {
    const placed = endpoint("placed");
    const node = defineEntryNode({
      name: "module",
      description: "Module",
      segments: [overrideHttpSegment({ segment: ":module" })],
      endpoints: [placed],
    });
    const tree = defineEntryTree(node);

    const treeHttp: string[] = [];
    collectHttpRoutes(tree).forEach((route) => {
      treeHttp.push(route.path);
    });
    const nodeHttp: string[] = [];
    collectHttpRoutes(node).forEach((route) => {
      nodeHttp.push(route.path);
    });
    expect(treeHttp).toEqual(["/"]);
    expect(nodeHttp).toEqual(["/:module"]);

    const directCli = collectCliCommands(node);
    expect(directCli.root).toMatchObject({
      token: "",
      path: [],
      description: "",
    });
    expect(directCli.root.commands.length).toBe(0);
    expect(directCli.root.children[0]).toMatchObject({
      token: "module",
      path: ["module"],
    });
  });

  it("supports empty trees and heterogeneous group-only nodes", () => {
    const tree = defineEntryTree(
      defineEntryNode({
        name: "empty-program",
        description: "Empty program",
        children: [
          defineEntryNode({ name: "empty-group", description: "Empty group" }),
        ],
      }),
    );
    expect(collectHttpRoutes(tree).length).toBe(0);
    expect(collectMcpTools(tree).length).toBe(0);
    const cli = collectCliCommands(tree);
    expect(cli.root.token).toBe("empty-program");
    expect(cli.root.children[0]?.description).toBe("Empty group");
  });

  it("projects host-ready CLI option and positional metadata", () => {
    const entry = defineEntry({
      name: "parameters",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
        defineParameter({
          name: "limit",
          codec: codecs.positiveInteger(),
          requirement: required(),
          description: "Limit",
        }),
      ],
      project: ({ values }) => values,
    });
    const placed = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [
        bindCliEntry({
          parameters: [
            { kind: "positional", parameterName: "query", valueName: "TERM" },
            {
              kind: "option",
              parameterName: "limit",
              flags: ["--limit", "-n"],
              valueName: "COUNT",
            },
          ],
          help: {
            optionSections: [
              {
                heading: "Limits",
                parameterNames: ["limit"],
              },
            ],
          },
        }),
      ],
    });
    const view = collectCliCommands(
      defineEntryTree(
        defineEntryNode({
          name: "app",
          description: "App",
          endpoints: [placed],
        }),
      ),
    );
    view.root.commands.forEach((command) => {
      expect(command.parameters).toMatchObject([
        {
          kind: "positional",
          parameterName: "query",
          valueName: "TERM",
          variadic: false,
        },
        {
          kind: "option",
          parameterName: "limit",
          flags: ["--limit", "-n"],
          valueName: "COUNT",
        },
      ]);
    });
    expect(view.root.help.positionals[0]?.valueName).toBe("TERM");
    expect(view.root.help.optionGroups[0]?.options[0]?.parameterName).toBe(
      "limit",
    );
    expect(view.root.help.optionGroups[0]?.heading).toBe("Limits");
  });

  it("rejects representative invalid public bindings before registration", () => {
    const queryEntry = defineEntry({
      name: "query",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
        defineParameter({
          name: "format",
          codec: codecs.string(),
          requirement: optional({ default: "text" }),
          description: "Format",
        }),
      ],
      project: ({ values }) => values,
    });
    const handler = (input: ReturnType<typeof queryEntry.project>) => input;
    const collectCli = (binding: ReturnType<typeof bindCliEntry>) =>
      collectCliCommands(
        defineEntryNode({
          name: "query",
          description: "Query",
          endpoints: [
            defineEntryEndpoint(queryEntry, {
              handler,
              channels: [binding],
            }),
          ],
        }),
      );

    const validCli = collectCli(
      bindCliEntry({
        parameters: [
          { kind: "option", parameterName: "query", flags: ["--query"] },
        ],
        help: {
          optionSections: [{ heading: "Input", parameterNames: ["query"] }],
        },
      }),
    );
    expect(validCli.root.children[0]?.commands.length).toBe(1);

    expect(() =>
      collectCli(
        bindCliEntry({
          parameters: [{ kind: "option", parameterName: "query", flags: [] }],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    expect(() =>
      collectCli(
        bindCliEntry({
          parameters: [
            {
              kind: "option",
              parameterName: "query",
              // @ts-expect-error CLI option flags must begin with a dash
              flags: ["query"],
            },
          ],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    expect(() =>
      collectCli(
        bindCliEntry({
          parameters: [{ kind: "positional", parameterName: "query" }],
          help: {
            optionSections: [
              {
                heading: "Not an option",
                // @ts-expect-error option sections may only name option bindings
                parameterNames: ["query"],
              },
            ],
          },
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    const validMcp = defineEntryEndpoint(queryEntry, {
      handler,
      channels: [bindMcpEntry({ name: "query", exclude: ["format"] })],
    });
    expect(
      collectMcpTools(
        defineEntryNode({
          name: "query",
          description: "Query",
          endpoints: [validMcp],
        }),
      ).length,
    ).toBe(1);

    const duplicateMcpExclusion = defineEntryEndpoint(queryEntry, {
      handler,
      channels: [
        bindMcpEntry({ name: "query", exclude: ["format", "format"] }),
      ],
    });
    expect(() =>
      collectMcpTools(
        defineEntryNode({
          name: "query",
          description: "Query",
          endpoints: [duplicateMcpExclusion],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    const invalidHttp = defineEntryEndpoint(queryEntry, {
      handler,
      channels: [bindHttpEntry({ method: "GET", exclude: ["missing"] })],
    });
    expect(() =>
      collectHttpRoutes(
        defineEntryNode({
          name: "query",
          description: "Query",
          endpoints: [invalidHttp],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    const cli = bindCliEntry({
      parameters: [{ kind: "option", parameterName: "query" }],
    });
    const duplicateChannel = defineEntryEndpoint(queryEntry, {
      handler,
      channels: [cli, cli],
    });
    expect(() =>
      collectCliCommands(
        defineEntryNode({
          name: "query",
          description: "Query",
          endpoints: [duplicateChannel],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);
  });

  it("rejects invalid HTTP methods and individual path segments", () => {
    const httpEndpoint = (method: string) =>
      defineEntryEndpoint(EmptyEntry, {
        handler: () => ({ ok: true as const }),
        channels: [bindHttpEntry({ method })],
      });
    const httpNode = (input: {
      readonly method: string;
      readonly segment: string;
    }) =>
      defineEntryNode({
        name: "route",
        description: "Route",
        segments: [overrideHttpSegment({ segment: input.segment })],
        endpoints: [httpEndpoint(input.method)],
      });

    const valid = collectHttpRoutes(
      httpNode({ method: "POST", segment: "valid-segment" }),
    );
    expect(valid.length).toBe(1);
    valid.forEach((route) => {
      expect(route.method).toBe("POST");
      expect(route.path).toBe("/valid-segment");
    });

    expect(() =>
      collectHttpRoutes(
        httpNode({ method: "BAD METHOD", segment: "valid-segment" }),
      ),
    ).toThrow(EntryTreeDefinitionError);
    expect(() =>
      collectHttpRoutes(
        httpNode({ method: "POST", segment: "invalid/segment" }),
      ),
    ).toThrow(EntryTreeDefinitionError);
  });

  it("rejects non-final variadics and repeat bindings on scalar codecs", () => {
    const entry = defineEntry({
      name: "portable-cli",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
        defineParameter({
          name: "tags",
          codec: codecs.stringList(),
          requirement: optional(),
          description: "Tags",
        }),
      ],
      project: ({ values }) => values,
    });
    const collect = (
      parameters: Parameters<typeof bindCliEntry>[0]["parameters"],
    ) =>
      collectCliCommands(
        defineEntryNode({
          name: "portable-cli",
          description: "Portable CLI",
          endpoints: [
            defineEntryEndpoint(entry, {
              handler: (input: ReturnType<typeof entry.project>) => input,
              channels: [bindCliEntry({ parameters })],
            }),
          ],
        }),
      );

    const validPositionals = collect([
      { kind: "positional", parameterName: "query" },
      { kind: "positional", parameterName: "tags", variadic: true },
    ]);
    expect(validPositionals.root.children[0]?.commands.length).toBe(1);
    expect(() =>
      collect([
        { kind: "positional", parameterName: "tags", variadic: true },
        { kind: "positional", parameterName: "query" },
      ]),
    ).toThrow(EntryTreeDefinitionError);

    const validRepeat = collect([
      { kind: "option", parameterName: "query" },
      {
        kind: "option",
        parameterName: "tags",
        repeatMode: "comma_or_repeat",
      },
    ]);
    expect(validRepeat.root.children[0]?.commands.length).toBe(1);
    expect(() =>
      collect([
        {
          kind: "option",
          parameterName: "query",
          repeatMode: "comma_or_repeat",
        },
      ]),
    ).toThrow(EntryTreeDefinitionError);
  });

  it("keeps two placements while applying channel-specific deduplication", () => {
    const shared = endpoint("shared");
    const tree = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        children: [
          defineEntryNode({
            name: "a",
            description: "A",
            endpoints: [shared, shared],
          }),
          defineEntryNode({ name: "b", description: "B", endpoints: [shared] }),
        ],
      }),
    );
    const httpPaths: string[] = [];
    collectHttpRoutes(tree).forEach((route) => {
      expect(route.endpoint).toBe(shared);
      expect(route.entry).toBe(EmptyEntry);
      expect(route.handler).toBe(shared.handler);
      httpPaths.push(route.path);
    });
    expect(httpPaths).toEqual(["/a", "/b"]);
    const mcp = collectMcpTools(tree);
    expect(mcp.length).toBe(1);
    mcp.forEach((tool) => {
      expect(tool.endpoint).toBe(shared);
      expect(tool.handler).toBe(shared.handler);
    });

    const cliPaths: string[][] = [];
    const cli = collectCliCommands(tree);
    for (const child of cli.root.children) {
      child.commands.forEach((command) => {
        cliPaths.push([...command.path]);
      });
    }
    expect(cliPaths).toEqual([["a"], ["b"]]);
  });

  it("deduplicates the same endpoint at the same HTTP placement", () => {
    const shared = endpoint("same-public-place");
    const tree = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        children: [
          defineEntryNode({
            name: "left",
            description: "Left",
            segments: [overrideHttpSegment({ segment: ":id" })],
            endpoints: [shared],
          }),
          defineEntryNode({
            name: "right",
            description: "Right",
            segments: [overrideHttpSegment({ segment: ":id" })],
            endpoints: [shared],
          }),
        ],
      }),
    );
    const routes: { method: string; path: string }[] = [];
    collectHttpRoutes(tree).forEach((route) => {
      routes.push({ method: route.method, path: route.path });
    });
    expect(routes).toEqual([{ method: "PROPFIND", path: "/:id" }]);
  });

  it("merges explicitly compatible nodes and their endpoint unions", () => {
    const first = endpoint("first");
    const second = endpoint("second", "PATCH");
    const merged = mergeEntryTreeNodes([
      defineEntryNode({
        name: "shared",
        description: "Shared",
        endpoints: [first],
      }),
      defineEntryNode({
        name: "shared",
        description: "Shared",
        endpoints: [second],
      }),
    ]);
    const tree = defineEntryTree(
      defineEntryNode({ name: "app", description: "App", children: merged }),
    );
    const methods: string[] = [];
    collectHttpRoutes(tree).forEach((route) => {
      methods.push(route.method);
    });
    expect(methods).toEqual(["PROPFIND", "PATCH"]);
  });

  it("rejects collisions, blank names, duplicate child tokens, and cycles", () => {
    const first = endpoint("duplicate");
    const second = endpoint("duplicate");
    const conflicting = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        endpoints: [first, second],
      }),
    );
    expect(() => collectHttpRoutes(conflicting)).toThrow(
      EntryTreeDefinitionError,
    );
    expect(() => collectMcpTools(conflicting)).toThrow(
      EntryTreeDefinitionError,
    );
    expect(() => collectCliCommands(conflicting)).toThrow(
      EntryTreeDefinitionError,
    );

    const blankMcp = defineEntryEndpoint(EmptyEntry, {
      handler: () => undefined,
      channels: [bindMcpEntry({ name: "   " })],
    });
    expect(() =>
      collectMcpTools(
        defineEntryNode({
          name: "blank",
          description: "Blank",
          endpoints: [blankMcp],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    const duplicateTokens = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        children: [
          defineEntryNode({
            name: "one",
            description: "One",
            segments: [overrideCliSegment({ token: "same" })],
          }),
          defineEntryNode({
            name: "two",
            description: "Two",
            segments: [overrideCliSegment({ token: "same" })],
          }),
        ],
      }),
    );
    expect(() => collectCliCommands(duplicateTokens)).toThrow(
      EntryTreeDefinitionError,
    );

    const children: EntryTreeNode[] = [];
    const cyclic = {
      name: "cycle",
      description: "Cycle",
      documentation: { remarks: [], relatedDocs: [] },
      segments: [],
      endpoints: [],
      children,
    } as unknown as EntryTreeNode;
    children.push(cyclic);
    expect(() => collectHttpRoutes(cyclic)).toThrow(EntryTreeDefinitionError);
  });
});
