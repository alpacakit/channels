import type { JsonValue } from "@alpacaloop/core";
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
  describeEntry,
  describeEntryTree,
  ENTRY_OUTPUT_DESCRIPTION_KIND,
  optional,
  PARAMETER_REQUIREMENT_KIND,
  required,
  VALUE_SHAPE_KIND,
  type ValueCodec,
} from "../src/index.js";

const Parameters = [
  defineParameter({
    name: "query",
    codec: codecs.string(),
    requirement: required(),
    description: "Search query",
  }),
  defineParameter({
    name: "format",
    codec: codecs.stringEnum(["text", "json"]),
    requirement: optional(),
    description: "Output format",
  }),
  defineParameter({
    name: "verbose",
    codec: codecs.boolean(),
    requirement: optional({ default: false }),
    description: "Verbose output",
  }),
  defineParameter({
    name: "nullable",
    codec: codecs.string() as unknown as ValueCodec<JsonValue>,
    requirement: optional<JsonValue>({ default: null }),
    description: "Explicit nullable default",
  }),
] as const;

const OutputlessEntry = defineEntry({
  name: "inspect",
  parameters: Parameters,
  project: ({ values }) => values,
});

const TypedEntry = defineEntry({
  name: "inspect-json",
  parameters: [],
  project: () => null,
  output: createOutputContract(
    z
      .object({ status: z.literal("ok") })
      .strict()
      .readonly(),
  ),
});

describe("neutral entry introspection", () => {
  it("describes requirements, defaults, value shapes and output presence", () => {
    expect(describeEntry(OutputlessEntry)).toEqual({
      name: "inspect",
      parameters: [
        {
          name: "query",
          description: "Search query",
          requirement: { kind: PARAMETER_REQUIREMENT_KIND.required },
          shape: { kind: VALUE_SHAPE_KIND.string },
        },
        {
          name: "format",
          description: "Output format",
          requirement: { kind: PARAMETER_REQUIREMENT_KIND.optional },
          shape: {
            kind: VALUE_SHAPE_KIND.stringEnum,
            values: ["text", "json"],
          },
        },
        {
          name: "verbose",
          description: "Verbose output",
          requirement: {
            kind: PARAMETER_REQUIREMENT_KIND.optionalWithDefault,
            defaultValue: false,
          },
          shape: { kind: VALUE_SHAPE_KIND.boolean },
        },
        {
          name: "nullable",
          description: "Explicit nullable default",
          requirement: {
            kind: PARAMETER_REQUIREMENT_KIND.optionalWithDefault,
            defaultValue: null,
          },
          shape: { kind: VALUE_SHAPE_KIND.string },
        },
      ],
      output: { kind: ENTRY_OUTPUT_DESCRIPTION_KIND.none },
    });
    expect(describeEntry(TypedEntry).output).toEqual({
      kind: ENTRY_OUTPUT_DESCRIPTION_KIND.typed,
    });
  });

  it("describes a three-level logical tree without exposing channel payloads", () => {
    const description = describeEntryTree(
      defineEntryTree(
        defineEntryNode({
          name: "alpaca",
          description: "Root",
          documentation: { remarks: ["Root remark"], relatedDocs: [] },
          children: [
            defineEntryNode({
              name: "issue",
              description: "Issue commands",
              children: [
                defineEntryNode({
                  name: "show",
                  description: "Show an issue",
                  documentation: { remarks: [], relatedDocs: ["issues"] },
                  endpoints: [
                    defineEntryEndpoint(OutputlessEntry),
                    defineEntryEndpoint(TypedEntry),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );

    expect(description.path).toEqual([]);
    expect(description.documentation).toEqual({
      remarks: ["Root remark"],
      relatedDocs: [],
    });
    expect(description.children[0]?.path).toEqual(["issue"]);
    expect(description.children[0]?.children[0]).toMatchObject({
      path: ["issue", "show"],
      name: "show",
      documentation: { remarks: [], relatedDocs: ["issues"] },
      endpoints: [
        { name: "inspect", output: { kind: "none" } },
        { name: "inspect-json", output: { kind: "typed" } },
      ],
    });
    expect(JSON.stringify(description)).not.toContain("binding");
    expect(JSON.stringify(description)).not.toContain("segment");
  });
});
