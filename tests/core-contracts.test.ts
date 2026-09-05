import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  codecs,
  createOutputContract,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  describeEntryTree,
  EntryInputError,
  EntryOutputContractError,
  optional,
  verifyEntryOutput,
} from "../src/index.js";
import { bindMcpEntry, collectMcpTools } from "../src/mcp.js";

describe("independent core contracts", () => {
  it("keeps explicit output verification independent from handlers", () => {
    const entry = defineEntry({
      name: "output",
      parameters: [],
      project: () => undefined,
      output: createOutputContract(z.object({ message: z.string() })),
    });
    expect(verifyEntryOutput(entry, { message: "ok" })).toEqual({
      message: "ok",
    });
    expect(() => verifyEntryOutput(entry, { message: 1 } as never)).toThrow(
      EntryOutputContractError,
    );
  });

  it("preserves introspection without granting an execution surface", () => {
    const entry = defineEntry({
      name: "inspect",
      parameters: [
        defineParameter({
          name: "value",
          codec: codecs.string(),
          requirement: optional({ default: "default" }),
          description: "Value",
        }),
      ],
      project: ({ values }) => values.value,
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [bindMcpEntry({ name: "inspect" })],
    });
    const description = describeEntryTree(
      defineEntryTree(
        defineEntryNode({
          name: "app",
          description: "App",
          endpoints: [endpoint],
          children: [
            defineEntryNode({
              name: "group",
              description: "Group",
              children: [
                defineEntryNode({
                  name: "inspect",
                  description: "Nested inspection",
                  endpoints: [endpoint],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    expect(description.endpoints[0]).toMatchObject({
      name: "inspect",
      parameters: [
        {
          name: "value",
          requirement: {
            kind: "optional_with_default",
            defaultValue: "default",
          },
        },
      ],
    });
    expect(description.children[0]?.children[0]).toMatchObject({
      path: ["group", "inspect"],
      name: "inspect",
      endpoints: [{ name: "inspect" }],
    });
    expect(description).not.toHaveProperty("handler");
  });

  it("preserves an expected EntryInputError thrown by project", () => {
    const expected = new EntryInputError(["combination is invalid"]);
    const entry = defineEntry({
      name: "project-input-error",
      parameters: [],
      project: () => {
        throw expected;
      },
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: () => undefined,
      channels: [bindMcpEntry({ name: "project-input-error" })],
    });
    collectMcpTools(
      defineEntryNode({
        name: "project-input-error",
        description: "Project input error",
        endpoints: [endpoint],
      }),
    ).forEach((tool) => {
      expect(() => tool.input.parse({})).toThrow(expected);
    });
  });
});
