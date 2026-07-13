import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  bindCliEntry,
  CLI_OPTION_KIND,
  CLI_OPTION_VALUE_MODE,
  type CLI_ROUTER_RESULT_KIND,
  type CliHelpOption,
  type CliRouterResult,
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
  type EntryChannelBinding,
  type EntryTreeDefinition,
  type EntryTreeEndpoint,
  type EntryTreeNode,
  optional,
  PARAMETER_REQUIREMENT_KIND,
  type ParameterValues,
  required,
  VALUE_SHAPE_KIND,
  type ValueShape,
} from "../src/index.js";
import {
  bindMcpEntry,
  createMcpEndpoint,
  isMcpResolved,
  type McpBinding,
} from "../src/mcp.js";

describe("entry tree builder types", () => {
  it("keeps parameter-name safety in builders and erases stored endpoint types", () => {
    const entry = defineEntry({
      name: "hint",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
      ],
      project: ({ values }) => values.query,
    });
    const cli = bindCliEntry({
      parameters: [
        { kind: "option", parameterName: "query", flags: ["--query"] },
      ],
    });
    const explicitMcp = ["query"] as const satisfies McpBinding<
      typeof entry.parameters
    >;
    const mcp = bindMcpEntry(...explicitMcp);
    const endpoint = defineEntryEndpoint(entry, cli, mcp);
    const tree = defineEntryTree(
      defineEntryNode({
        name: "tool",
        description: "Tool",
        segments: [overrideCliSegment({ token: "t", aliases: ["tool"] })],
        endpoints: [endpoint],
      }),
    );

    expectTypeOf(cli.binding).toEqualTypeOf<unknown>();
    expectTypeOf(cli).toMatchTypeOf<EntryChannelBinding<"cli", "query">>();
    expectTypeOf(explicitMcp[0]).toEqualTypeOf<"query">();
    expectTypeOf(endpoint).toMatchTypeOf<EntryTreeEndpoint>();
    expectTypeOf(endpoint).toEqualTypeOf<EntryTreeEndpoint<typeof entry>>();
    expectTypeOf(endpoint.entry).toEqualTypeOf<typeof entry>();
    expectTypeOf(tree.root.endpoints[0]).toEqualTypeOf<
      EntryTreeEndpoint | undefined
    >();
    expectTypeOf(tree).toEqualTypeOf<EntryTreeDefinition>();
    expectTypeOf({
      name: "raw",
      description: "Raw",
      segments: [],
      endpoints: [],
      children: [],
    }).not.toMatchTypeOf<EntryTreeNode>();

    defineEntryNode({
      name: "documented",
      description: "Documented",
      documentation: { remarks: ["Remark"] },
    });

    const result = createCliRouter(tree).resolve(["--query", "value"]);
    if (isCliResolvedEndpoint(result, endpoint)) {
      const projection: string = result.projection;
      expectTypeOf(projection).toEqualTypeOf<string>();
    }
    const mcpResult = createMcpEndpoint(endpoint).parse({ query: "value" });
    if (isMcpResolved(mcpResult)) {
      const projection: string = mcpResult.projection;
      expectTypeOf(projection).toEqualTypeOf<string>();
    }

    const invalidCli = bindCliEntry({
      parameters: [
        { kind: "option", parameterName: "missing", flags: ["--missing"] },
      ],
    });
    const invalidMcp = bindMcpEntry("missing");
    // @ts-expect-error the entry, not its bindings, fixes the parameter names
    defineEntryEndpoint(entry, invalidCli);
    // @ts-expect-error MCP bindings use the same NoInfer constraint
    defineEntryEndpoint(entry, invalidMcp);
  });

  it("materializes required and defaulted values in projection types", () => {
    const parameters = [
      defineParameter({
        name: "requiredValue",
        codec: codecs.string(),
        requirement: required(),
        description: "Required",
      }),
      defineParameter({
        name: "defaultedValue",
        codec: codecs.positiveInteger(),
        requirement: optional<number>({ default: 2 }),
        description: "Defaulted",
      }),
      defineParameter({
        name: "omittedValue",
        codec: codecs.boolean(),
        requirement: optional<boolean>(),
        description: "Omitted",
      }),
    ] as const;
    defineEntry({
      name: "materialized",
      parameters,
      project: ({ values }) => {
        expectTypeOf(values.requiredValue).toEqualTypeOf<string>();
        expectTypeOf(values.defaultedValue).toEqualTypeOf<number>();
        expectTypeOf(values.omittedValue).toEqualTypeOf<boolean | undefined>();
        return values;
      },
    });

    const complete: ParameterValues<typeof parameters> = {
      requiredValue: "value",
      defaultedValue: 2,
    };
    // @ts-expect-error required parameters remain required
    const missingRequired: ParameterValues<typeof parameters> = {
      defaultedValue: 2,
    };
    // @ts-expect-error defaulted parameters remain materialized
    const missingDefaulted: ParameterValues<typeof parameters> = {
      requiredValue: "value",
    };
    void complete;
    void missingRequired;
    void missingDefaulted;
  });

  it("stores only non-default CLI binding choices", () => {
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "items",
          flags: ["--item"],
          repeatMode: "comma_or_repeat",
        },
        {
          kind: "option",
          parameterName: "enabled",
          flags: ["--enabled"],
          negated: true,
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "items",
          flags: ["--item"],
          // @ts-expect-error repeated values are the implicit array default
          repeatMode: "repeat",
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "enabled",
          flags: ["--enabled"],
          // @ts-expect-error absence represents the non-negated choice
          negated: false,
        },
      ],
    });
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "query",
          // @ts-expect-error CLI option flags must begin with a hyphen
          flags: ["query"],
        },
      ],
    });
  });

  it("excludes impossible CLI help option field combinations", () => {
    const base = {
      parameterName: "value",
      flags: ["--value"] as const,
      description: "Value",
      requirement: { kind: PARAMETER_REQUIREMENT_KIND.required },
    };
    const booleanFlag = {
      ...base,
      kind: CLI_OPTION_KIND.booleanFlag,
      negativeFlags: ["--no-value"],
    } satisfies CliHelpOption;
    const value = {
      ...base,
      kind: CLI_OPTION_KIND.value,
      valueName: "VALUE",
      valueMode: CLI_OPTION_VALUE_MODE.replace,
    } satisfies CliHelpOption;

    expectTypeOf(booleanFlag).not.toHaveProperty("valueName");
    expectTypeOf(booleanFlag).not.toHaveProperty("valueMode");
    expectTypeOf(value).not.toHaveProperty("negativeFlags");

    const invalidBooleanFlag: CliHelpOption = {
      ...booleanFlag,
      // @ts-expect-error boolean flags never carry value-mode fields
      valueName: "VALUE",
    };
    const invalidValue: CliHelpOption = {
      ...value,
      // @ts-expect-error value options never carry generated negative flags
      negativeFlags: [],
    };
    void invalidBooleanFlag;
    void invalidValue;
  });

  it("separates general and parameter CLI input failures", () => {
    type InvalidInput = Extract<
      CliRouterResult,
      { readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidInput }
    >;
    type InvalidParameter = Extract<
      CliRouterResult,
      { readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidParameter }
    >;

    expectTypeOf<InvalidInput>().not.toHaveProperty("parameterName");
    expectTypeOf<InvalidParameter["parameterName"]>().toEqualTypeOf<string>();
  });

  it("requires authored CLI usage overrides to be non-empty", () => {
    bindCliEntry({
      parameters: [],
      help: {
        // @ts-expect-error an empty list means neither authored nor derived usage
        usages: [],
      },
    });
  });

  it("ties codec values to scalar or flat-array shapes", () => {
    codecs.define({
      // @ts-expect-error a string shape requires a string schema
      schema: z.boolean(),
      shape: { kind: VALUE_SHAPE_KIND.string },
    });
    const nestedArrayShape = {
      kind: VALUE_SHAPE_KIND.array,
      element: {
        // @ts-expect-error CLI array elements must be scalar
        kind: VALUE_SHAPE_KIND.array,
        element: { kind: VALUE_SHAPE_KIND.string },
      },
    } satisfies ValueShape;
    expectTypeOf(nestedArrayShape.kind).toEqualTypeOf<"array">();
  });
});
