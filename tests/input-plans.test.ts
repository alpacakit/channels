import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bindCliEntry,
  CLI_VALUE_COERCION,
  collectCliCommands,
} from "../src/cli.js";
import { bindHttpEntry, collectHttpRoutes } from "../src/http.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryChannelBinding,
  EntryInputError,
  EntryTreeDefinitionError,
  optional,
  required,
} from "../src/index.js";
import { bindMcpEntry, collectMcpTools } from "../src/mcp.js";

function caughtError(invoke: () => unknown): unknown {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error("Expected invocation to throw");
}

describe("JSON parameters", () => {
  const entry = defineEntry({
    name: "configure",
    parameters: [
      defineParameter({
        name: "plan",
        codec: codecs.json(
          z.union([
            z.object({ steps: z.array(z.string()) }),
            z.array(z.string()),
            z.string(),
            z.null(),
          ]),
        ),
        requirement: optional(),
        description: "Plan",
      }),
    ],
    project: ({ values }) => values.plan,
  });
  const node = (...channels: readonly EntryChannelBinding[]) =>
    defineEntryNode({
      name: "configure",
      description: "Configure a plan",
      endpoints: [defineEntryEndpoint(entry, { handler: () => {}, channels })],
    });

  it("parses a single CLI argument as JSON before applying the schema", () => {
    const commands = collectCliCommands(
      defineEntryTree(
        node(
          bindCliEntry({
            parameters: [{ kind: "option", parameterName: "plan" }],
          }),
        ),
      ),
    );
    expect(commands.root.commands.length).toBe(1);
    commands.root.commands.forEach(({ input }) => {
      expect(input.parseOptions({ plan: '{"steps":["build"]}' })).toEqual({
        steps: ["build"],
      });
      expect(input.parseOptions({ plan: '["null","true"]' })).toEqual([
        "null",
        "true",
      ]);
      expect(input.parseOptions({ plan: '"build"' })).toBe("build");
      expect(input.parseOptions({ plan: "null" })).toBeNull();
      expect(() => input.parseOptions({ plan: "build" })).toThrow(
        EntryInputError,
      );
    });
  });

  it("passes decoded HTTP body values through and rejects GET bindings", () => {
    const routes = collectHttpRoutes(node(bindHttpEntry({ method: "POST" })));
    expect(routes.length).toBe(1);
    routes.forEach(({ input }) => {
      expect(input.parse({ plan: { steps: ["build"] } })).toEqual({
        steps: ["build"],
      });
      expect(input.parse({ plan: "null" })).toBe("null");
      expect(() => input.parseQuery({ plan: "null" })).toThrow(EntryInputError);
    });
    expect(() =>
      collectHttpRoutes(node(bindHttpEntry({ method: "GET" }))),
    ).toThrow(EntryTreeDefinitionError);
    expect(
      collectHttpRoutes(
        node(bindHttpEntry({ method: "GET", exclude: ["plan"] })),
      ).length,
    ).toBe(1);
  });

  it("exposes the authored JSON schema in MCP tool input", () => {
    const tools = collectMcpTools(node(bindMcpEntry({ name: "configure" })));
    expect(tools.length).toBe(1);
    tools.forEach(({ input }) => {
      expect(z.toJSONSchema(input.schema, { io: "input" })).toMatchObject({
        properties: {
          plan: {
            anyOf: [
              {
                type: "object",
                properties: {
                  steps: { type: "array", items: { type: "string" } },
                },
                required: ["steps"],
              },
              { type: "array", items: { type: "string" } },
              { type: "string" },
              { type: "null" },
            ],
          },
        },
      });
    });
  });
});

describe("compiled input plans", () => {
  it("separates schema, project, and handler and runs each once", () => {
    const calls = { transform: 0, project: 0, handler: 0 };
    const amount = defineParameter({
      name: "amount",
      codec: codecs.define({
        schema: z.string().transform((value) => {
          calls.transform += 1;
          return Number(value);
        }),
        shape: { kind: "string" },
      }),
      requirement: optional({ default: "3" }),
      description: "Amount",
    });
    const entry = defineEntry({
      name: "once",
      parameters: [amount],
      project: ({ values }) => {
        calls.project += 1;
        return { amount: values.amount };
      },
    });
    const handler = (input: ReturnType<typeof entry.project>) => {
      calls.handler += 1;
      return input.amount * 2;
    };
    const endpoint = defineEntryEndpoint(entry, {
      handler,
      channels: [
        bindCliEntry({
          parameters: [{ kind: "option", parameterName: "amount" }],
        }),
        bindHttpEntry({ method: "PUT" }),
        bindMcpEntry({ name: "once" }),
      ],
    });
    const tree = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        endpoints: [endpoint],
      }),
    );

    const cli = collectCliCommands(tree);
    const http = collectHttpRoutes(tree);
    const mcp = collectMcpTools(tree);
    expect(calls).toEqual({ transform: 3, project: 0, handler: 0 });

    calls.transform = 0;
    cli.root.commands.forEach((command) => {
      expect(command.handler(command.input.parseOptions({}))).toBe(6);
    });
    http.forEach((route) => {
      expect(route.handler(route.input.parseQuery({}))).toBe(6);
    });
    expect(calls).toEqual({ transform: 2, project: 2, handler: 2 });

    calls.transform = 0;
    calls.project = 0;
    calls.handler = 0;
    cli.root.commands.forEach((command) => {
      const input = command.input.parseOptions({ amount: "4" });
      expect(command.handler).toBe(handler);
      expect(command.handler(input)).toBe(8);
    });
    expect(calls).toEqual({ transform: 1, project: 1, handler: 1 });

    calls.transform = 0;
    calls.project = 0;
    calls.handler = 0;
    http.forEach((route) => {
      const input = route.input.parseQuery({ amount: ["5"] });
      expect(route.handler(input)).toBe(10);
    });
    expect(calls).toEqual({ transform: 1, project: 1, handler: 1 });

    calls.transform = 0;
    calls.project = 0;
    calls.handler = 0;
    mcp.forEach((tool) => {
      const jsonSchema = z.toJSONSchema(tool.input.schema, { io: "input" });
      expect(jsonSchema).toMatchObject({
        properties: {
          amount: { type: "string", default: "3" },
        },
      });
      expect(jsonSchema.required ?? []).not.toContain("amount");
      const values = tool.input.schema.parse({});
      expect(calls).toEqual({ transform: 1, project: 0, handler: 0 });
      const input = tool.input.project(values);
      expect(tool.handler(input)).toBe(6);
      expect(calls).toEqual({ transform: 1, project: 1, handler: 1 });

      expect(() => tool.input.parse(values)).toThrow(EntryInputError);
      expect(calls).toEqual({ transform: 1, project: 1, handler: 1 });
    });
  });

  it("applies channel coercion without changing JSON parse semantics", () => {
    const enabled = defineParameter({
      name: "enabled",
      codec: codecs.boolean(),
      requirement: optional({ default: true }),
      description: "Enabled",
    });
    const limit = defineParameter({
      name: "limit",
      codec: codecs.positiveInteger(),
      requirement: required(),
      description: "Limit",
    });
    const labels = defineParameter({
      name: "labels",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Labels",
    });
    const metadata = defineParameter({
      name: "metadata",
      codec: codecs.define({
        schema: z.union([z.string(), z.record(z.string(), z.string())]),
        shape: { kind: "string" },
      }),
      requirement: optional(),
      description: "Metadata",
    });
    const entry = defineEntry({
      name: "coercion",
      parameters: [enabled, limit, labels, metadata],
      project: ({ values }) => values,
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [
        bindCliEntry({
          parameters: [
            { kind: "option", parameterName: "enabled", negated: true },
            { kind: "option", parameterName: "limit" },
            {
              kind: "option",
              parameterName: "labels",
              repeatMode: "comma_or_repeat",
            },
            {
              kind: "option",
              parameterName: "metadata",
              coercion: CLI_VALUE_COERCION.jsonOrString,
            },
          ],
        }),
        bindHttpEntry({ method: "SEARCH" }),
      ],
    });
    const tree = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "App",
        endpoints: [endpoint],
      }),
    );

    collectCliCommands(tree).root.commands.forEach((command) => {
      expect(
        command.input.parseOptions({
          enabled: false,
          limit: "2",
          labels: ["a,b", "c"],
          metadata: '{"owner":"alpaca"}',
        }),
      ).toEqual({
        enabled: false,
        limit: 2,
        labels: ["a", "b", "c"],
        metadata: { owner: "alpaca" },
      });
      expect(() => command.input.parse({ limit: "2" })).toThrow(
        EntryInputError,
      );
      expect(() =>
        command.input.parseOptions({ limit: "2", unknown: true }),
      ).toThrow(EntryInputError);
    });

    collectHttpRoutes(tree).forEach((route) => {
      expect(
        route.input.parseQuery({
          enabled: ["false"],
          limit: "4",
          labels: "one",
        }),
      ).toMatchObject({ enabled: false, limit: 4, labels: ["one"] });
      expect(() =>
        route.input.parseQuery({ enabled: ["true", "false"], limit: "4" }),
      ).toThrow(EntryInputError);
      expect(() => route.input.parseQuery({ enabled: [], limit: "4" })).toThrow(
        EntryInputError,
      );
      expect(() =>
        route.input.parseQuery({ limit: "4", unknown: "value" }),
      ).toThrow(EntryInputError);
    });
  });

  it("fills hidden optional/default values and prevents injection", () => {
    const entry = defineEntry({
      name: "hidden",
      parameters: [
        defineParameter({
          name: "visible",
          codec: codecs.string(),
          requirement: required(),
          description: "Visible",
        }),
        defineParameter({
          name: "note",
          codec: codecs.string(),
          requirement: optional(),
          description: "Note",
        }),
        defineParameter({
          name: "mode",
          codec: codecs.string(),
          requirement: optional({ default: "safe" }),
          description: "Mode",
        }),
      ],
      project: ({ values }) => values,
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [bindMcpEntry({ name: "hidden", exclude: ["note", "mode"] })],
    });
    const node = defineEntryNode({
      name: "hidden",
      description: "Hidden",
      endpoints: [endpoint],
    });
    collectMcpTools(node).forEach((tool) => {
      expect(tool.input.parse({ visible: "yes" })).toEqual({
        visible: "yes",
        mode: "safe",
      });
      expect(() =>
        tool.input.parse({ visible: "yes", mode: "unsafe" }),
      ).toThrow(EntryInputError);
    });
  });

  it("copies mutable defaults for every invocation", () => {
    const authoredDefault = { tags: ["stable"] };
    const settings = defineParameter({
      name: "settings",
      codec: codecs.define({
        schema: z.object({ tags: z.array(z.string()) }),
        shape: { kind: "string" },
      }),
      requirement: optional({ default: authoredDefault }),
      description: "Settings",
    });
    const entry = defineEntry({
      name: "settings",
      parameters: [settings],
      project: ({ values }) => values.settings,
    });
    const observed: { tags: string[] }[] = [];
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => {
        observed.push(input);
        return input;
      },
      channels: [bindMcpEntry({ name: "settings" })],
    });
    collectMcpTools(
      defineEntryNode({
        name: "settings",
        description: "Settings",
        endpoints: [endpoint],
      }),
    ).forEach((tool) => {
      tool.handler(tool.input.parse({}));
      observed[0]?.tags.push("changed");
      tool.handler(tool.input.parse({}));
      expect(observed[1]).toEqual({ tags: ["stable"] });
      expect(observed[1]).not.toBe(observed[0]);
      const jsonSchema = z.toJSONSchema(tool.input.schema, { io: "input" });
      expect(jsonSchema).toMatchObject({
        properties: {
          settings: { default: { tags: ["stable"] } },
        },
      });
    });
  });

  it("rejects non-record containers as expected input errors", () => {
    const entry = defineEntry({
      name: "container",
      parameters: [],
      project: ({ values }) => values,
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [
        bindCliEntry({ parameters: [] }),
        bindHttpEntry({ method: "POST" }),
        bindMcpEntry({ name: "container" }),
      ],
    });
    const node = defineEntryNode({
      name: "container",
      description: "Container validation",
      endpoints: [endpoint],
    });
    collectCliCommands(node).root.commands.forEach((command) => {
      for (const invalid of [null, [], "value", 1, true]) {
        expect(() =>
          Reflect.apply(command.input.parseOptions, undefined, [invalid]),
        ).toThrow(EntryInputError);
      }
    });
    collectHttpRoutes(node).forEach((route) => {
      for (const invalid of [null, [], "value", 1, true]) {
        expect(() =>
          Reflect.apply(route.input.parseQuery, undefined, [invalid]),
        ).toThrow(EntryInputError);
      }
    });
    collectMcpTools(node).forEach((tool) => {
      for (const invalid of [null, [], "value", 1, true]) {
        expect(() =>
          Reflect.apply(tool.input.parse, undefined, [invalid]),
        ).toThrow(EntryInputError);
      }
    });
  });

  it("rejects unreachable required parameters and preserves unexpected faults", () => {
    const requiredSecret = defineParameter({
      name: "secret",
      codec: codecs.string(),
      requirement: required(),
      description: "Secret",
    });
    const badEntry = defineEntry({
      name: "bad",
      parameters: [requiredSecret],
      project: ({ values }) => values,
    });
    const badEndpoint = defineEntryEndpoint(badEntry, {
      handler: (input: ReturnType<typeof badEntry.project>) => input,
      channels: [
        bindCliEntry({ parameters: [] }),
        bindHttpEntry({ method: "GET", exclude: ["secret"] }),
        bindMcpEntry({ name: "bad", exclude: ["secret"] }),
      ],
    });
    expect(() =>
      collectHttpRoutes(
        defineEntryNode({
          name: "bad",
          description: "Bad",
          endpoints: [badEndpoint],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);
    expect(() =>
      collectCliCommands(
        defineEntryNode({
          name: "bad",
          description: "Bad",
          endpoints: [badEndpoint],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);
    expect(() =>
      collectMcpTools(
        defineEntryNode({
          name: "bad",
          description: "Bad",
          endpoints: [badEndpoint],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);

    const projectFault = new Error("project fault");
    const faultEntry = defineEntry({
      name: "fault",
      parameters: [],
      project: () => {
        throw projectFault;
      },
    });
    const faultEndpoint = defineEntryEndpoint(faultEntry, {
      handler: () => undefined,
      channels: [bindMcpEntry({ name: "fault" })],
    });
    collectMcpTools(
      defineEntryNode({
        name: "fault",
        description: "Fault",
        endpoints: [faultEndpoint],
      }),
    ).forEach((tool) => {
      expect(() => tool.input.parse({})).toThrow(projectFault);
      expect(() => tool.input.parse({})).not.toThrow(EntryInputError);
    });
  });

  it("classifies only recognized coercion failures as input errors", () => {
    const codecFault = new Error("codec fault");
    const projectFault = new Error("project fault");
    const value = defineParameter({
      name: "value",
      codec: codecs.define({
        schema: z.string().transform((input) => {
          if (input === "codec-fault") {
            throw codecFault;
          }
          return input;
        }),
        shape: { kind: "string" },
      }),
      requirement: required(),
      description: "Value",
    });
    const tags = defineParameter({
      name: "tags",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Tags",
    });
    const entry = defineEntry({
      name: "fault-classification",
      parameters: [value, tags],
      project: ({ values }) => {
        if (values.value === "project-fault") {
          throw projectFault;
        }
        return values;
      },
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [
        bindCliEntry({
          parameters: [
            {
              kind: "option",
              parameterName: "value",
              coercion: CLI_VALUE_COERCION.json,
            },
            {
              kind: "option",
              parameterName: "tags",
              repeatMode: "comma_or_repeat",
            },
          ],
        }),
        bindHttpEntry({ method: "GET" }),
      ],
    });
    const tree = defineEntryTree(
      defineEntryNode({
        name: "fault-classification",
        description: "Fault classification",
        endpoints: [endpoint],
      }),
    );

    const cli = collectCliCommands(tree);
    expect(cli.root.commands.length).toBe(1);
    let cliRegistrations = 0;
    cli.root.commands.forEach((command) => {
      cliRegistrations += 1;
      const invalidJson = caughtError(() =>
        command.input.parseOptions({ value: "{" }),
      );
      expect(invalidJson).toBeInstanceOf(EntryInputError);
      if (invalidJson instanceof EntryInputError) {
        expect(invalidJson.target).toEqual({
          kind: "parameter",
          parameterName: "value",
        });
      }

      const getterFault = new Error("adapter getter fault");
      const raw = Object.defineProperty({}, "value", {
        enumerable: true,
        get() {
          throw getterFault;
        },
      });
      expect(caughtError(() => command.input.parse(raw))).toBe(getterFault);
      expect(caughtError(() => command.input.parseOptions(raw))).toBe(
        getterFault,
      );

      const coercionFault = new Error("coercion fault");
      const faultingList = new Proxy(["one"], {
        get(target, property, receiver) {
          if (property === "flatMap") {
            throw coercionFault;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      expect(
        caughtError(() =>
          command.input.parseOptions({ value: '"ok"', tags: faultingList }),
        ),
      ).toBe(coercionFault);
      expect(
        caughtError(() => command.input.parse({ value: "codec-fault" })),
      ).toBe(codecFault);
      expect(
        caughtError(() =>
          command.input.parseOptions({ value: '"codec-fault"' }),
        ),
      ).toBe(codecFault);
      expect(
        caughtError(() => command.input.parse({ value: "project-fault" })),
      ).toBe(projectFault);
      expect(
        caughtError(() =>
          command.input.parseOptions({ value: '"project-fault"' }),
        ),
      ).toBe(projectFault);
    });
    expect(cliRegistrations).toBe(1);

    const http = collectHttpRoutes(tree);
    expect(http.length).toBe(1);
    let httpRegistrations = 0;
    http.forEach((route) => {
      httpRegistrations += 1;
      const duplicateScalar = caughtError(() =>
        route.input.parseQuery({ value: ["one", "two"] }),
      );
      expect(duplicateScalar).toBeInstanceOf(EntryInputError);
      if (duplicateScalar instanceof EntryInputError) {
        expect(duplicateScalar.target).toEqual({
          kind: "parameter",
          parameterName: "value",
        });
      }

      const getterFault = new Error("HTTP adapter getter fault");
      const raw = Object.defineProperty({}, "value", {
        enumerable: true,
        get() {
          throw getterFault;
        },
      });
      expect(caughtError(() => route.input.parse(raw))).toBe(getterFault);
      expect(caughtError(() => route.input.parseQuery(raw))).toBe(getterFault);

      const coercionFault = new Error("HTTP coercion fault");
      const faultingList = new Proxy(["one"], {
        get(target, property, receiver) {
          if (property === "map") {
            throw coercionFault;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      expect(
        caughtError(() =>
          route.input.parseQuery({ value: "ok", tags: faultingList }),
        ),
      ).toBe(coercionFault);
      expect(
        caughtError(() => route.input.parse({ value: "codec-fault" })),
      ).toBe(codecFault);
      expect(
        caughtError(() => route.input.parseQuery({ value: "codec-fault" })),
      ).toBe(codecFault);
      expect(
        caughtError(() => route.input.parse({ value: "project-fault" })),
      ).toBe(projectFault);
      expect(
        caughtError(() => route.input.parseQuery({ value: "project-fault" })),
      ).toBe(projectFault);
    });
    expect(httpRegistrations).toBe(1);
  });

  it("rejects an authored Raw default that its codec cannot decode", () => {
    const entry = defineEntry({
      name: "invalid-default",
      parameters: [
        defineParameter({
          name: "count",
          codec: codecs.define({
            schema: z
              .string()
              .transform((value) => Number(value))
              .pipe(z.number()),
            shape: { kind: "string" },
          }),
          requirement: optional({ default: "not-a-number" }),
          description: "Count",
        }),
      ],
      project: ({ values }) => values.count,
    });
    const endpoint = defineEntryEndpoint(entry, {
      handler: (input: ReturnType<typeof entry.project>) => input,
      channels: [bindMcpEntry({ name: "invalid-default" })],
    });
    expect(() =>
      collectMcpTools(
        defineEntryNode({
          name: "invalid-default",
          description: "Invalid default",
          endpoints: [endpoint],
        }),
      ),
    ).toThrow(EntryTreeDefinitionError);
  });
});
