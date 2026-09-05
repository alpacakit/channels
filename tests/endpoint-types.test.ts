import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { bindCliEntry, collectCliCommands } from "../src/cli.js";
import { bindHttpEntry, collectHttpRoutes } from "../src/http.js";
import {
  type ContextFor,
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EndpointsOfNode,
  EntryTreeDefinitionError,
  type EntryTreeNode,
  type OutputFor,
  optional,
  type ParameterSet,
  type ParameterValues,
  required,
} from "../src/index.js";
import { bindMcpEntry, collectMcpTools } from "../src/mcp.js";

const TYPECHECK_NEGATIVE =
  Reflect.get(process.env, "TYPECHECK_NEGATIVE") === "1";

const countCodec = codecs.define({
  schema: z.string().transform((value) => Number(value)),
  shape: { kind: "string" },
});

const unknownInputCodec = codecs.define({
  schema: z.preprocess((value) => value, z.number()),
  shape: { kind: "positive_integer" },
});

defineParameter({
  name: "unknown-input",
  codec: unknownInputCodec,
  requirement: optional({ default: 1 }),
  description:
    "Schema accepts unknown input while the authored default is JSON",
});

const CountEntry = defineEntry({
  name: "count",
  parameters: [
    defineParameter({
      name: "count",
      codec: countCodec,
      requirement: optional({ default: "2" }),
      description: "Count",
    }),
  ],
  project: ({ values }) => ({ count: values.count }),
});

const TextEntry = defineEntry({
  name: "text",
  parameters: [
    defineParameter({
      name: "text",
      codec: codecs.string(),
      requirement: optional({ default: "alpaca" }),
      description: "Text",
    }),
  ],
  project: ({ values }) => ({
    original: values.text,
    upper: values.text.toUpperCase(),
  }),
});

function defineGenericEndpoint<Input>(
  project: () => Input,
  handler: (input: Input) => string,
) {
  const entry = defineEntry({
    name: "generic",
    parameters: [],
    project,
  });
  return defineEntryEndpoint(entry, {
    handler,
    channels: [bindMcpEntry({ name: "generic" })],
  });
}

function defineParameterConfigEndpoint<
  const Parameters extends ParameterSet,
  Input,
>(input: {
  readonly parameters: Parameters;
  readonly project: (values: {
    readonly values: ParameterValues<Parameters>;
  }) => Input;
  readonly handler: (value: Input) => string;
}) {
  const entry = defineEntry({
    name: "generic-parameter-config",
    parameters: input.parameters,
    project: input.project,
  });
  return defineEntryEndpoint(entry, {
    handler: input.handler,
    channels: [bindMcpEntry({ name: "generic_parameter_config" })],
  });
}

const GenericEndpoint = defineGenericEndpoint(
  () => ({ name: "hello" }),
  (input) => input.name,
);
const GenericParameter = defineParameter({
  name: "name",
  codec: codecs.string(),
  requirement: required(),
  description: "Name",
});
const GenericParameterConfigEndpoint = defineParameterConfigEndpoint({
  parameters: [GenericParameter],
  project: ({ values }) => ({ name: values.name }),
  handler: (input) => input.name,
});

type CountInput = ReturnType<typeof CountEntry.project>;
type DbContext = { readonly db: { readonly query: string } };
type TraceContext = { readonly trace: (message: string) => void };

function countWithDb(input: CountInput, context: DbContext) {
  return {
    kind: "count" as const,
    value: input.count + context.db.query.length,
  };
}

async function countWithOptionalTrace(
  input: CountInput,
  context?: TraceContext,
) {
  await Promise.resolve();
  context?.trace(String(input.count));
  return `count:${input.count}`;
}

function countWithDefaultInput(
  input: CountInput = { count: 0 },
  context: TraceContext,
) {
  context.trace(String(input.count));
  return input.count;
}

function countWithOptionalDefaults(
  input: CountInput = { count: 0 },
  context?: TraceContext,
) {
  context?.trace(String(input.count));
  return input.count;
}

const decoratedHandler = Object.assign(
  (input: CountInput, context: { readonly prefix: string }) =>
    `${context.prefix}${input.count}`,
  { tag: "business" as const },
);

const DbEndpoint = defineEntryEndpoint(CountEntry, {
  handler: countWithDb,
  channels: [
    bindCliEntry({
      parameters: [{ kind: "option", parameterName: "count" }],
    }),
  ],
});

const OptionalEndpoint = defineEntryEndpoint(CountEntry, {
  handler: countWithOptionalTrace,
  channels: [
    bindCliEntry({
      parameters: [{ kind: "option", parameterName: "count" }],
    }),
  ],
});

const DefaultInputEndpoint = defineEntryEndpoint(CountEntry, {
  handler: countWithDefaultInput,
  channels: [bindMcpEntry({ name: "default-count" })],
});

const OptionalDefaultsEndpoint = defineEntryEndpoint(CountEntry, {
  handler: countWithOptionalDefaults,
  channels: [bindMcpEntry({ name: "optional-defaults" })],
});

const ZeroArgumentEndpoint = defineEntryEndpoint(CountEntry, {
  handler: () => ({ kind: "zero" as const }),
  channels: [bindMcpEntry({ name: "zero" })],
});

const OneArgumentEndpoint = defineEntryEndpoint(CountEntry, {
  handler: (input: CountInput) => input.count,
  channels: [bindMcpEntry({ name: "one" })],
});

const HttpOnlyEndpoint = defineEntryEndpoint(CountEntry, {
  handler: (input: CountInput, context: { readonly requestId: string }) =>
    `${context.requestId}:${input.count}`,
  channels: [bindHttpEntry({ method: "PATCH" })],
});

const DecoratedEndpoint = defineEntryEndpoint(CountEntry, {
  handler: decoratedHandler,
  channels: [
    bindCliEntry({
      parameters: [{ kind: "option", parameterName: "count" }],
    }),
    bindHttpEntry({ method: "GET" }),
    bindMcpEntry({ name: "decorated" }),
  ],
});

const TextEndpoint = defineEntryEndpoint(TextEntry, {
  handler: (input: ReturnType<typeof TextEntry.project>) =>
    input.original === input.upper,
  channels: [
    bindCliEntry({
      parameters: [{ kind: "option", parameterName: "text" }],
    }),
  ],
});

const DbClientEndpoint = defineEntryEndpoint(CountEntry, {
  handler: (
    input: CountInput,
    context: { readonly client: { readonly kind: "db" } },
  ) => context.client.kind === "db" && input.count,
  channels: [bindMcpEntry({ name: "db-client" })],
});

const HttpClientEndpoint = defineEntryEndpoint(CountEntry, {
  handler: (
    input: CountInput,
    context: { readonly client: { readonly kind: "http" } },
  ) => context.client.kind === "http" && input.count,
  channels: [bindMcpEntry({ name: "http-client" })],
});

const HeterogeneousNode = defineEntryNode({
  name: "typed",
  description: "Typed endpoints",
  children: [
    defineEntryNode({
      name: "db",
      description: "Database",
      endpoints: [DbEndpoint],
    }),
    defineEntryNode({
      name: "trace",
      description: "Trace",
      endpoints: [OptionalEndpoint],
    }),
    defineEntryNode({
      name: "text",
      description: "Different schema and projection",
      endpoints: [TextEndpoint],
    }),
    defineEntryNode({
      name: "other",
      description: "Other channels",
      endpoints: [
        DefaultInputEndpoint,
        OptionalDefaultsEndpoint,
        ZeroArgumentEndpoint,
        OneArgumentEndpoint,
        HttpOnlyEndpoint,
      ],
    }),
    defineEntryNode({ name: "empty", description: "Empty" }),
  ],
});

describe("typed Endpoint and collector boundaries", () => {
  it("constructs endpoints through generic consumer helpers", () => {
    expect(GenericEndpoint.handler({ name: "world" })).toBe("world");
    expect(
      GenericParameterConfigEndpoint.handler({ name: "parameter-set" }),
    ).toBe("parameter-set");
    expectTypeOf(GenericEndpoint.handler).toEqualTypeOf<
      (input: { name: string }) => string
    >();
    expectTypeOf(GenericParameterConfigEndpoint.handler).toEqualTypeOf<
      (input: { name: string }) => string
    >();
  });

  it("keeps concrete handlers and heterogeneous node inference", () => {
    expect(DbEndpoint.handler).toBe(countWithDb);
    expectTypeOf(DbEndpoint.handler).toEqualTypeOf(countWithDb);
    expectTypeOf(DefaultInputEndpoint.handler).toEqualTypeOf(
      countWithDefaultInput,
    );
    expectTypeOf<
      ContextFor<typeof DefaultInputEndpoint>
    >().toEqualTypeOf<TraceContext>();
    expectTypeOf<ContextFor<typeof OptionalEndpoint>>().toEqualTypeOf<
      TraceContext | undefined
    >();
    expectTypeOf<
      ContextFor<typeof ZeroArgumentEndpoint | typeof OneArgumentEndpoint>
    >().toEqualTypeOf<unknown>();
    expectTypeOf<EndpointsOfNode<typeof HeterogeneousNode>>().toEqualTypeOf<
      | typeof DbEndpoint
      | typeof OptionalEndpoint
      | typeof DefaultInputEndpoint
      | typeof OptionalDefaultsEndpoint
      | typeof ZeroArgumentEndpoint
      | typeof OneArgumentEndpoint
      | typeof HttpOnlyEndpoint
      | typeof TextEndpoint
    >();
  });

  it("preserves the complete original handler type", () => {
    expect(DecoratedEndpoint.handler).toBe(decoratedHandler);
    expect(DecoratedEndpoint.handler.tag).toBe("business");
    expectTypeOf(DecoratedEndpoint.handler).toEqualTypeOf(decoratedHandler);
    expectTypeOf(DecoratedEndpoint.handler.tag).toEqualTypeOf<"business">();
  });

  it("derives optional context when both handler parameters are optional", () => {
    expectTypeOf<ContextFor<typeof OptionalDefaultsEndpoint>>().toEqualTypeOf<
      TraceContext | undefined
    >();
    collectMcpTools(
      defineEntryNode({
        name: "optional-defaults",
        description: "Optional default input and context",
        endpoints: [OptionalDefaultsEndpoint],
      }),
    ).forEach((tool) => {
      const input = tool.input.parse({});
      tool.handler(input);
      tool.handler(input, { trace: () => undefined });
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error optional context still retains its concrete type
        tool.handler(input, { wrong: true });
      }
    });
  });

  it("keeps conservatively erased channel collections uncallable", () => {
    const precise = defineEntryNode({
      name: "decorated",
      description: "Decorated handler",
      endpoints: [DecoratedEndpoint],
    });
    collectCliCommands(precise).root.commands.forEach((command) => {
      command.handler(command.input.parseOptions({}), { prefix: "cli:" });
    });
    collectHttpRoutes(precise).forEach((route) => {
      route.handler(route.input.parse({}), { prefix: "http:" });
    });
    collectMcpTools(precise).forEach((tool) => {
      tool.handler(tool.input.parse({}), { prefix: "mcp:" });
    });

    const erased: EntryTreeNode = precise;
    collectCliCommands(erased).root.commands.forEach((command) => {
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error erased CLI metadata cannot supply a safe context
        command.handler(command.input.parseOptions({}));
      }
    });
    collectHttpRoutes(erased).forEach((route) => {
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error erased HTTP metadata cannot supply a safe context
        route.handler(route.input.parse({}));
      }
    });
    collectMcpTools(erased).forEach((tool) => {
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error erased MCP metadata cannot supply a safe context
        tool.handler(tool.input.parse({}));
      }
    });
    expect(true).toBe(true);
  });

  it("provides an intersection context and awaited output union", () => {
    const tree = defineEntryTree(HeterogeneousNode);
    const cli = collectCliCommands(tree);
    type CliEndpoints =
      | typeof DbEndpoint
      | typeof OptionalEndpoint
      | typeof TextEndpoint;
    expectTypeOf<ContextFor<CliEndpoints>>().toEqualTypeOf<
      DbContext & (TraceContext | undefined)
    >();
    expectTypeOf<OutputFor<CliEndpoints>>().toEqualTypeOf<
      ReturnType<typeof countWithDb> | string | boolean
    >();

    let visited = 0;
    for (const node of cli.root.children) {
      node.commands.forEach((command) => {
        const input = command.input.parseOptions({});
        const result = command.handler(input, {
          db: { query: "select" },
          trace: () => undefined,
        });
        expectTypeOf(result).toEqualTypeOf<
          | ReturnType<typeof countWithDb>
          | string
          | boolean
          | PromiseLike<ReturnType<typeof countWithDb> | string | boolean>
        >();
        if (TYPECHECK_NEGATIVE) {
          // @ts-expect-error the required DB context is missing from the whole CLI collection
          command.handler(input, { trace: () => undefined });
        }
        visited += 1;
      });
    }
    expect(visited).toBe(3);
  });

  it("filters channel context before collection", () => {
    const tree = defineEntryTree(HeterogeneousNode);
    collectMcpTools(tree).forEach((tool) => {
      const input = tool.input.parse({});
      tool.handler(input, { trace: () => undefined });
    });
    collectHttpRoutes(tree).forEach((route) => {
      const input = route.input.parse({});
      route.handler(input, { requestId: "request-1" });
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error HTTP context is required
        route.handler(input);
      }
    });
  });

  it("makes incompatible collection contexts uncallable without a cast", () => {
    const impossible = defineEntryTree(
      defineEntryNode({
        name: "impossible",
        description: "Incompatible contexts",
        children: [
          defineEntryNode({
            name: "db",
            description: "DB",
            endpoints: [DbClientEndpoint],
          }),
          defineEntryNode({
            name: "http",
            description: "HTTP",
            endpoints: [HttpClientEndpoint],
          }),
        ],
      }),
    );
    collectMcpTools(impossible).forEach((tool) => {
      const input = tool.input.parse({});
      if (TYPECHECK_NEGATIVE) {
        // @ts-expect-error the intersected client discriminator is never
        tool.handler(input, { client: { kind: "db" } });
      }
    });
    expect(true).toBe(true);
  });

  it("rejects invalid handler and raw-default types at definition sites", () => {
    if (TYPECHECK_NEGATIVE) {
      defineEntryEndpoint(CountEntry, {
        // @ts-expect-error handler input cannot receive the Entry projection
        handler: (input: { wrong: string }) => input.wrong,
        channels: [],
      });
      defineEntryEndpoint(CountEntry, {
        // @ts-expect-error rest handlers are not a single concrete 0-2 argument signature
        handler: (...args: readonly CountInput[]) => args.length,
        channels: [],
      });
      defineEntryEndpoint(CountEntry, {
        // @ts-expect-error third handler arguments are unsupported
        handler: (_input: CountInput, _context: DbContext, _extra: string) => 1,
        channels: [],
      });
      defineParameter({
        name: "wrong-default",
        codec: countCodec,
        // @ts-expect-error authored defaults use the codec Raw type, not decoded Value
        requirement: optional({ default: 2 }),
        description: "Wrong default",
      });
    }
    expect(true).toBe(true);
  });

  it("rejects a JS-style three-required-argument handler at runtime", () => {
    const twoArguments = (input: CountInput, context: DbContext) =>
      input.count + context.db.query.length;
    const valid = defineEntryEndpoint(CountEntry, {
      handler: twoArguments,
      channels: [],
    });
    expect(valid.handler).toBe(twoArguments);

    const threeArguments = (
      input: CountInput,
      context: DbContext,
      extra: string,
    ) => input.count + context.db.query.length + extra.length;
    const jsStyleHandler = threeArguments as unknown as (
      input: CountInput,
    ) => number;
    expect(() =>
      defineEntryEndpoint(CountEntry, {
        handler: jsStyleHandler,
        channels: [],
      }),
    ).toThrow(EntryTreeDefinitionError);
  });
});
