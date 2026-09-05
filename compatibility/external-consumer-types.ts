import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type ParameterSet,
  type ParameterValues,
  required,
} from "@alpacakit/channels";
import { bindCliEntry, collectCliCommands } from "@alpacakit/channels/cli";

const TextEntry = defineEntry({
  name: "text",
  parameters: [
    defineParameter({
      name: "value",
      codec: codecs.string(),
      requirement: required(),
      description: "Text",
    }),
  ],
  project: ({ values }): { readonly kind: "text"; readonly text: string } => ({
    kind: "text",
    text: values.value,
  }),
});
const NumberEntry = defineEntry({
  name: "number",
  parameters: [
    defineParameter({
      name: "value",
      codec: codecs.positiveInteger(),
      requirement: required(),
      description: "Number",
    }),
  ],
  project: ({
    values,
  }): { readonly kind: "number"; readonly value: number } => ({
    kind: "number",
    value: values.value,
  }),
});
const EmptyEntry = defineEntry({
  name: "empty",
  parameters: [],
  project: (): { readonly kind: "empty" } => ({ kind: "empty" }),
});

function makeGenericEndpoint<Input>(
  project: () => Input,
  handler: (input: Input) => string,
) {
  const entry = defineEntry({ name: "generic", parameters: [], project });
  return defineEntryEndpoint(entry, {
    handler,
    channels: [bindCliEntry({ parameters: [] })],
  });
}

function makeParameterConfigEndpoint<
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
    channels: [],
  });
}

const genericEndpoint = makeGenericEndpoint(
  () => ({ name: "hello" }),
  (input) => input.name,
);
genericEndpoint.handler({ name: "world" });

const genericParameter = defineParameter({
  name: "value",
  codec: codecs.string(),
  requirement: required(),
  description: "Generic parameter",
});
const genericParameterEndpoint = makeParameterConfigEndpoint({
  parameters: [genericParameter],
  project: ({ values }) => ({ value: values.value }),
  handler: (input) => input.value,
});
genericParameterEndpoint.handler({ value: "ok" });

makeGenericEndpoint(
  // @ts-expect-error a generic consumer handler must accept its projected input
  () => ({ name: "hello" }),
  (input: { value: number }) => String(input.value),
);

const noArgumentHandler = (): { readonly kind: "zero" } => ({ kind: "zero" });
const oneArgumentHandler = (
  input: ReturnType<typeof TextEntry.project>,
): { readonly kind: "text"; readonly text: string } => ({
  kind: "text",
  text: input.text,
});
type DatabaseContext = { readonly database: { readonly name: string } };
const requiredContextHandler = (
  input: ReturnType<typeof NumberEntry.project>,
  context: DatabaseContext,
): {
  readonly kind: "number";
  readonly value: number;
  readonly db: string;
} => ({
  kind: "number",
  value: input.value,
  db: context.database.name,
});
type TraceContext = { readonly trace: (message: string) => void };
const optionalContextHandler = (
  input: ReturnType<typeof TextEntry.project>,
  context?: TraceContext,
): { readonly kind: "optional"; readonly text: string } => {
  context?.trace(input.text);
  return { kind: "optional", text: input.text };
};
const optionalInputAndContextHandler = (
  input: ReturnType<typeof TextEntry.project> = {
    kind: "text",
    text: "default",
  },
  context?: TraceContext,
): { readonly kind: "optional_both"; readonly text: string } => {
  context?.trace(input.text);
  return { kind: "optional_both", text: input.text };
};

const cli = bindCliEntry({
  parameters: [{ kind: "option", parameterName: "value" }],
});
const emptyCli = bindCliEntry({ parameters: [] });
const ZeroEndpoint = defineEntryEndpoint(EmptyEntry, {
  handler: noArgumentHandler,
  channels: [emptyCli],
});
const TextEndpoint = defineEntryEndpoint(TextEntry, {
  handler: oneArgumentHandler,
  channels: [cli],
});
const NumberEndpoint = defineEntryEndpoint(NumberEntry, {
  handler: requiredContextHandler,
  channels: [cli],
});
const OptionalContextEndpoint = defineEntryEndpoint(TextEntry, {
  handler: optionalContextHandler,
  channels: [cli],
});
const OptionalBothEndpoint = defineEntryEndpoint(TextEntry, {
  handler: optionalInputAndContextHandler,
  channels: [cli],
});

const TypeTree = defineEntryTree(
  defineEntryNode({
    name: "types",
    description: "Type contract",
    children: [
      defineEntryNode({
        name: "zero",
        description: "Zero arguments",
        endpoints: [ZeroEndpoint],
      }),
      defineEntryNode({
        name: "text",
        description: "One argument",
        endpoints: [TextEndpoint],
      }),
      defineEntryNode({
        name: "number",
        description: "Required context",
        endpoints: [NumberEndpoint],
      }),
      defineEntryNode({
        name: "optional-context",
        description: "Optional context",
        endpoints: [OptionalContextEndpoint],
      }),
      defineEntryNode({
        name: "optional-both",
        description: "Optional input and context",
        endpoints: [OptionalBothEndpoint],
      }),
    ],
  }),
);

type ExpectedOutput =
  | { readonly kind: "zero" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly value: number; readonly db: string }
  | { readonly kind: "optional"; readonly text: string }
  | { readonly kind: "optional_both"; readonly text: string };

const typedView = collectCliCommands(TypeTree);
for (const child of typedView.root.children) {
  child.commands.forEach((command) => {
    const input = command.input.parseOptions({ value: "1" });
    const output: ExpectedOutput | PromiseLike<ExpectedOutput> =
      command.handler(input, { database: { name: "typed" }, trace: () => {} });
    void output;
    // @ts-expect-error the required collection context is not optional
    command.handler(input);
    // @ts-expect-error the collection context must include the database dependency
    command.handler(input, { trace: () => {} });
  });
}

NumberEndpoint.handler(NumberEntry.project({ values: { value: 1 } }), {
  database: { name: "ok" },
});
NumberEndpoint.handler(
  {
    kind: "number",
    // @ts-expect-error the concrete handler input is projected numeric input
    value: "wrong",
  },
  {
    database: { name: "bad" },
  },
);
// @ts-expect-error the concrete handler requires its context
NumberEndpoint.handler(NumberEntry.project({ values: { value: 1 } }));

const optionalTree = defineEntryTree(
  defineEntryNode({
    name: "optional",
    description: "Optional input and context",
    endpoints: [OptionalBothEndpoint],
  }),
);
collectCliCommands(optionalTree).root.commands.forEach((command) => {
  const input = command.input.parseOptions({ value: "ok" });
  command.handler(input);
  command.handler(input, { trace: () => {} });
  // @ts-expect-error wrong optional context
  command.handler(input, { database: { name: "wrong" } });
});

type DbClientContext = { readonly client: { readonly kind: "database" } };
type HttpClientContext = { readonly client: { readonly kind: "http" } };
const dbHandler = (
  _input: ReturnType<typeof TextEntry.project>,
  _context: DbClientContext,
): { readonly kind: "db" } => ({ kind: "db" });
const httpHandler = (
  _input: ReturnType<typeof TextEntry.project>,
  _context: HttpClientContext,
): { readonly kind: "http" } => ({ kind: "http" });
const DbEndpoint = defineEntryEndpoint(TextEntry, {
  handler: dbHandler,
  channels: [cli],
});
const HttpEndpoint = defineEntryEndpoint(TextEntry, {
  handler: httpHandler,
  channels: [cli],
});
const DbModule = defineEntryNode({
  name: "db",
  description: "DB module",
  endpoints: [DbEndpoint],
});
const HttpModule = defineEntryNode({
  name: "http",
  description: "HTTP module",
  endpoints: [HttpEndpoint],
});
const incompatibleTree = defineEntryTree(
  defineEntryNode({
    name: "all",
    description: "All modules",
    children: [DbModule, HttpModule],
  }),
);
collectCliCommands(incompatibleTree).root.children[0]?.commands.forEach(
  (command) => {
    const input = command.input.parseOptions({ value: "x" });
    // @ts-expect-error incompatible module contexts make the all-tree context impossible
    command.handler(input, { client: { kind: "database" } });
  },
);
collectCliCommands(DbModule).root.children[0]?.commands.forEach((command) => {
  const input = command.input.parseOptions({ value: "x" });
  command.handler(input, { client: { kind: "database" } });
  // @ts-expect-error DB subtree preserves its own context
  command.handler(input, { client: { kind: "http" } });
});
collectCliCommands(HttpModule).root.children[0]?.commands.forEach((command) => {
  const input = command.input.parseOptions({ value: "x" });
  command.handler(input, { client: { kind: "http" } });
  // @ts-expect-error HTTP subtree preserves its own context
  command.handler(input, { client: { kind: "database" } });
});

defineEntryEndpoint(NumberEntry, {
  // @ts-expect-error handler input does not match Entry.project output
  handler: oneArgumentHandler,
  channels: [cli],
});
requiredContextHandler(NumberEntry.project({ values: { value: 1 } }), {
  // @ts-expect-error handler context has the wrong shape at invocation
  trace: () => {},
});
