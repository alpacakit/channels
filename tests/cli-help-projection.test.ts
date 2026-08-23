import { describe, expect, it } from "vitest";
import {
  bindCliEntry,
  createCliRouter,
  listCliHelpSurfaces,
  overrideCliSegment,
  projectCliHelpSurface,
  renderCliHelp,
} from "../src/cli.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryChannelBinding,
  EntryTreeDefinitionError,
  optional,
} from "../src/index.js";

const OptionsEntry = defineEntry({
  name: "options",
  parameters: [
    defineParameter({
      name: "first",
      codec: codecs.string(),
      requirement: optional(),
      description: "First option",
    }),
    defineParameter({
      name: "second",
      codec: codecs.string(),
      requirement: optional(),
      description: "Second option",
    }),
    defineParameter({
      name: "target",
      codec: codecs.string(),
      requirement: optional(),
      description: "Target argument",
    }),
  ],
  project: ({ values }) => values,
});

function createHelpTree() {
  return defineEntryTree(
    defineEntryNode({
      name: "alpaca",
      description: "Alpaca commands",
      documentation: {
        remarks: ["Root remark."],
        relatedDocs: ["config"],
      },
      segments: [
        overrideCliSegment({
          token: "alpaca",
          help: {
            subcommandHint: "Choose a command and request its help.",
            examples: [
              {
                title: "Inspect",
                useWhen: "you need command details",
                command: "create --help",
              },
            ],
          },
        }),
      ],
      children: [
        defineEntryNode({
          name: "create",
          description: "Create an item",
          documentation: {
            remarks: ["Creation is idempotent."],
            relatedDocs: ["creation"],
          },
          endpoints: [
            defineEntryEndpoint(
              OptionsEntry,
              bindCliEntry({
                parameters: [
                  { kind: "option", parameterName: "first" },
                  { kind: "option", parameterName: "second" },
                  { kind: "positional", parameterName: "target" },
                ],
                help: {
                  usages: ["--first <FIRST> [TARGET]"],
                  optionSections: [
                    {
                      heading: "Selection",
                      description: "Choose the input.",
                      parameterNames: ["second", "first"],
                    },
                  ],
                  examples: [
                    {
                      title: "Create",
                      useWhen: "an item is missing",
                      command: "create --first one",
                      expectedResult: ["The item is created."],
                    },
                  ],
                },
              }),
            ),
          ],
        }),
        defineEntryNode({
          name: "list",
          description: "List items",
          endpoints: [
            defineEntryEndpoint(
              OptionsEntry,
              bindCliEntry({
                parameters: [
                  { kind: "option", parameterName: "first" },
                  { kind: "option", parameterName: "second" },
                  { kind: "positional", parameterName: "target" },
                ],
              }),
            ),
          ],
        }),
        defineEntryNode({
          name: "guide",
          description: "Guide commands",
          segments: [
            overrideCliSegment({
              token: "guide",
              help: { subcommandHint: "Guide help." },
            }),
          ],
          children: [
            defineEntryNode({
              name: "open",
              description: "Open the guide",
              endpoints: [
                defineEntryEndpoint(
                  defineEntry({
                    name: "open-guide",
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
}

describe("CLI help editorial projection", () => {
  it("projects visibility and order without rebuilding help fields", () => {
    const help = createCliRouter(createHelpTree()).help;
    const projected = projectCliHelpSurface(help, {
      include: ({ path }) => path[0] !== "list",
      compare: (left, right) =>
        right.path.join(" ").localeCompare(left.path.join(" ")),
    });

    expect(projected.children.map((child) => child.token)).toEqual([
      "guide",
      "create",
    ]);
    expect(projected.children[1]?.remarks).toEqual(["Creation is idempotent."]);
  });

  it("projects normalized T1/T2 help and derives omitted usages", () => {
    const help = createCliRouter(createHelpTree()).help;
    const create = help.children[0];
    const list = help.children[1];

    expect(help).toMatchObject({
      remarks: ["Root remark."],
      relatedDocs: ["config"],
      subcommandHint: "Choose a command and request its help.",
      examples: [
        {
          title: "Inspect",
          expectedResult: [],
        },
      ],
    });
    expect(create).toMatchObject({
      usages: ["--first <FIRST> [TARGET]"],
      remarks: ["Creation is idempotent."],
      relatedDocs: ["creation"],
      optionGroups: [
        {
          heading: "Selection",
          description: "Choose the input.",
          options: [{ parameterName: "second" }, { parameterName: "first" }],
        },
      ],
    });
    expect(list?.usages).toEqual(["[options] [TARGET]"]);
    expect(list?.optionGroups).toMatchObject([
      {
        heading: null,
        description: null,
        options: [{ parameterName: "first" }, { parameterName: "second" }],
      },
    ]);
  });

  it("renders every projected editorial field in the default flat format", () => {
    const root = createCliRouter(createHelpTree()).help;
    const rendered = listCliHelpSurfaces(root)
      .map(({ surface, path }) =>
        renderCliHelp(surface, {
          executableName: "alpaca",
          programName: ["alpaca", ...path].join(" "),
          path,
          withDescription: true,
        }),
      )
      .join("\n\n---\n\n");

    expect(rendered).toContain("Usage: alpaca create --first <FIRST> [TARGET]");
    expect(rendered).toContain("Root remark.");
    expect(rendered).toContain("Selection\n    Choose the input.");
    const groupedOptions = rendered.slice(rendered.indexOf("Selection"));
    expect(groupedOptions.indexOf("--second")).toBeLessThan(
      groupedOptions.indexOf("--first"),
    );
    expect(rendered).toContain("Use when an item is missing");
    expect(rendered).toContain("Expected result:\n      The item is created.");
    expect(rendered).toContain("Related documentation:\n  creation");
    expect(rendered).toContain("Choose a command and request its help.");
    expect(rendered).toContain("Usage: alpaca guide <command>");
    expect(rendered).toContain("Guide help.");
  });
});

describe("CLI help definition validation", () => {
  const expectInvalidHelp = (
    binding: EntryChannelBinding<"cli", "first" | "second" | "target">,
    issue: string,
  ) => {
    try {
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "root",
            description: "Root",
            endpoints: [defineEntryEndpoint(OptionsEntry, binding)],
          }),
        ),
      );
      throw new Error("Expected CLI help validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EntryTreeDefinitionError);
      if (error instanceof EntryTreeDefinitionError) {
        expect(error.issues.join("\n")).toContain(issue);
      }
    }
  };

  it("rejects option sections that name a positional or list an option twice", () => {
    const parameters = [
      { kind: "option", parameterName: "first" },
      { kind: "option", parameterName: "second" },
      { kind: "positional", parameterName: "target" },
    ] as const;
    expectInvalidHelp(
      bindCliEntry({
        parameters,
        help: {
          optionSections: [
            {
              heading: "Invalid",
              parameterNames: [
                // @ts-expect-error option sections cannot name positionals
                "target",
              ],
            },
          ],
        },
      }),
      "non-option parameter target",
    );
    expectInvalidHelp(
      bindCliEntry({
        parameters,
        help: {
          optionSections: [
            { heading: "One", parameterNames: ["first"] },
            { heading: "Two", parameterNames: ["first"] },
          ],
        },
      }),
      "appears more than once",
    );
  });

  it.each([
    { title: "", command: "create", issue: "title must not be empty" },
    { title: "Create", command: "", issue: "command must not be empty" },
  ])("rejects empty example fields ($issue)", ({ title, command, issue }) => {
    expectInvalidHelp(
      bindCliEntry({
        parameters: [
          { kind: "option", parameterName: "first" },
          { kind: "option", parameterName: "second" },
          { kind: "positional", parameterName: "target" },
        ],
        help: {
          examples: [{ title, useWhen: "testing", command }],
        },
      }),
      issue,
    );
  });

  it("rejects an unregistered CLI binding payload", () => {
    const valid = bindCliEntry({
      parameters: [{ kind: "option", parameterName: "first" }],
    });
    const unregistered = {
      ...valid,
      binding: { ...(valid.binding as Record<string, unknown>) },
    } as typeof valid;

    expectInvalidHelp(unregistered, "invalid CLI endpoint binding");
  });

  it("rejects an unregistered CLI segment payload", () => {
    const valid = overrideCliSegment({ token: "root" });
    const unregistered = {
      ...valid,
      segment: { ...(valid.segment as Record<string, unknown>) },
    } as typeof valid;

    expect(() =>
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "root",
            description: "Root",
            segments: [unregistered],
          }),
        ),
      ),
    ).toThrow("invalid CLI segment override");
  });

  it("rejects a subcommand hint on a leaf", () => {
    expect(() =>
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "root",
            description: "Root",
            segments: [
              overrideCliSegment({
                token: "root",
                help: { subcommandHint: "No child exists." },
              }),
            ],
            endpoints: [
              defineEntryEndpoint(
                defineEntry({
                  name: "empty",
                  parameters: [],
                  project: () => null,
                }),
                bindCliEntry({ parameters: [] }),
              ),
            ],
          }),
        ),
      ),
    ).toThrow("subcommand hint requires at least one child command");
  });

  it("rejects a subcommand hint on a pruned non-executable leaf", () => {
    const endpoint = defineEntryEndpoint(
      defineEntry({
        name: "root-command",
        parameters: [],
        project: () => null,
      }),
      bindCliEntry({ parameters: [] }),
    );
    expect(() =>
      createCliRouter(
        defineEntryTree(
          defineEntryNode({
            name: "root",
            description: "Root",
            endpoints: [endpoint],
            children: [
              defineEntryNode({
                name: "hidden-leaf",
                description: "Hidden leaf",
                segments: [
                  overrideCliSegment({
                    token: "hidden-leaf",
                    help: { subcommandHint: "No child exists." },
                  }),
                ],
              }),
            ],
          }),
        ),
      ),
    ).toThrow("subcommand hint requires at least one child command");
  });
});
