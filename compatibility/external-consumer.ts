import assert from "node:assert/strict";
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
} from "@alpacakit/channels";
import {
  bindCliEntry,
  CLI_BOOLEAN_MODE,
  CLI_OPTION_KIND,
  CLI_OPTION_VALUE_MODE,
  type CliParameterView,
  collectCliCommands,
} from "@alpacakit/channels/cli";
import { bindHttpEntry, collectHttpRoutes } from "@alpacakit/channels/http";
import { bindMcpEntry, collectMcpTools } from "@alpacakit/channels/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Command, Option } from "commander";
import { Hono } from "hono";
import { z } from "zod";
import {
  createCliProgram as createGreetingCliProgram,
  createHttpApp as createGreetingHttpApp,
  createMcpServer as createGreetingMcpServer,
} from "./packed-greeting.js";

const calls = { transform: 0, project: 0, handler: 0 };

const stringInteger = codecs.define({
  schema: z
    .string()
    .regex(/^\d+$/u)
    .transform((value) => {
      calls.transform += 1;
      return Number(value);
    }),
  shape: { kind: "string" },
});

const settingsCodec = codecs.define({
  schema: z.object({ label: z.string() }),
  shape: { kind: "string" },
});

const SearchEntry = defineEntry({
  name: "search",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Search text",
    }),
    defineParameter({
      name: "limit",
      codec: stringInteger,
      requirement: optional({ default: "2" }),
      description: "Maximum results",
    }),
    defineParameter({
      name: "feature",
      codec: codecs.boolean(),
      requirement: optional({ default: true }),
      description: "Feature switch",
    }),
    defineParameter({
      name: "tags",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Result tags",
    }),
    defineParameter({
      name: "settings",
      codec: settingsCodec,
      requirement: optional({ default: { label: "fresh" } }),
      description: "Mutable clone probe",
    }),
    defineParameter({
      name: "hiddenNote",
      codec: codecs.string(),
      requirement: optional(),
      description: "Not exposed",
    }),
    defineParameter({
      name: "hiddenMode",
      codec: codecs.string(),
      requirement: optional({ default: "private" }),
      description: "Hidden authored default",
    }),
  ],
  project: ({ values }) => {
    calls.project += 1;
    return {
      query: values.query,
      limit: values.limit,
      feature: values.feature,
      tags: values.tags ?? [],
      settings: values.settings,
      hiddenNote: values.hiddenNote ?? null,
      hiddenMode: values.hiddenMode,
    };
  },
});

type SearchInput = ReturnType<typeof SearchEntry.project>;
type SearchContext = { readonly caller: string };
type SearchResult = {
  readonly caller: string;
  readonly query: string;
  readonly limit: number;
  readonly feature: boolean;
  readonly tags: readonly string[];
  readonly settingBeforeMutation: string;
  readonly hiddenNote: string | null;
  readonly hiddenMode: string;
};

function search(input: SearchInput, context: SearchContext): SearchResult {
  calls.handler += 1;
  const result = {
    caller: context.caller,
    query: input.query,
    limit: input.limit,
    feature: input.feature,
    tags: input.tags,
    settingBeforeMutation: input.settings.label,
    hiddenNote: input.hiddenNote,
    hiddenMode: input.hiddenMode,
  };
  input.settings.label = "mutated";
  return result;
}

const SearchEndpoint = defineEntryEndpoint(SearchEntry, {
  handler: search,
  channels: [
    bindHttpEntry({
      method: "GET",
      exclude: ["hiddenNote", "hiddenMode"],
    }),
    bindMcpEntry({
      name: "catalog_search",
      exclude: ["hiddenNote", "hiddenMode"],
    }),
    bindCliEntry({
      parameters: [
        {
          kind: "option",
          parameterName: "query",
          flags: ["-q", "--query"],
        },
        { kind: "option", parameterName: "limit" },
        {
          kind: "option",
          parameterName: "feature",
          booleanMode: CLI_BOOLEAN_MODE.flag,
          negated: true,
        },
        {
          kind: "option",
          parameterName: "tags",
          flags: ["-t", "--tag"],
          repeatMode: CLI_OPTION_VALUE_MODE.commaOrRepeat,
        },
        {
          kind: "option",
          parameterName: "settings",
          coercion: "json",
        },
      ],
    }),
  ],
});

const EmptyGroup = defineEntryNode({
  name: "empty",
  description: "Intentionally empty group",
});
const FirstPlacement = defineEntryNode({
  name: "search",
  description: "Search placement",
  endpoints: [SearchEndpoint],
});
const GroupOnly = defineEntryNode({
  name: "tools",
  description: "Group without its own endpoint",
  children: [FirstPlacement, EmptyGroup],
});
const SecondPlacement = defineEntryNode({
  name: "find",
  description: "Second placement of the same endpoint",
  endpoints: [SearchEndpoint],
});
const AppTree = defineEntryTree(
  defineEntryNode({
    name: "catalog",
    description: "Parent command is executable and has children",
    endpoints: [SearchEndpoint],
    children: [GroupOnly, SecondPlacement],
  }),
);

const httpRoutes = collectHttpRoutes(AppTree);
const mcpTools = collectMcpTools(AppTree);
const cliTree = collectCliCommands(AppTree);
calls.transform = 0;
calls.project = 0;
calls.handler = 0;

assert.equal(SearchEndpoint.handler, search);
assert.equal(httpRoutes.length, 3);
assert.equal(mcpTools.length, 1);
assert.equal(cliTree.root.commands.length, 1);
assert.equal(cliTree.root.children.length, 2);
assert.equal(cliTree.root.children[0]?.commands.length, 0);
assert.equal(cliTree.root.children[0]?.children[1]?.commands.length, 0);

function snapshotCalls(): typeof calls {
  return { ...calls };
}

function assertOneInvocation(before: typeof calls): void {
  assert.deepEqual(calls, {
    transform: before.transform + 1,
    project: before.project + 1,
    handler: before.handler + 1,
  });
}

const app = new Hono();
httpRoutes.forEach((route) => {
  app.on(route.method, route.path, async (context) => {
    const input = route.input.parseQuery(context.req.queries());
    const result = await route.handler(input, { caller: "http" });
    return context.json(result);
  });
});
app.onError((error, context) =>
  error instanceof EntryInputError
    ? context.json({ error: "invalid_input" }, 400)
    : context.json({ error: "unexpected" }, 500),
);

let before = snapshotCalls();
let response = await app.request("/?query=root&limit=3&feature=false");
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {
  caller: "http",
  query: "root",
  limit: 3,
  feature: false,
  tags: [],
  settingBeforeMutation: "fresh",
  hiddenNote: null,
  hiddenMode: "private",
});
assertOneInvocation(before);

before = snapshotCalls();
response = await app.request("/tools/search?query=child");
assert.equal(response.status, 200);
const secondHttpResult: SearchResult = await response.json();
assert.equal(secondHttpResult.settingBeforeMutation, "fresh");
assertOneInvocation(before);

before = snapshotCalls();
response = await app.request("/find?query=alias&limit=bad");
assert.equal(response.status, 400);
assert.equal(calls.project, before.project);
assert.equal(calls.handler, before.handler);
assert.equal((await app.request("/?query=x&unknown=y")).status, 400);
assert.equal((await app.request("/?query=x&hiddenNote=inject")).status, 400);
assert.equal((await app.request("/?query=a&query=b")).status, 400);
console.log(
  "PASS HTTP: actual Hono app.request -> parseQuery -> shared handler -> c.json",
);

type CliMapping = {
  readonly parameterName: string;
  readonly attribute: string;
};

function addCliOptions(
  command: Command,
  spec: { readonly parameters: readonly CliParameterView[] },
): readonly CliMapping[] {
  const mappings: CliMapping[] = [];
  for (const parameter of spec.parameters) {
    if (parameter.kind !== "option") {
      throw new Error("This consumer supports option bindings only");
    }
    if (parameter.optionKind === CLI_OPTION_KIND.booleanFlag) {
      for (const flags of [parameter.flags, parameter.negativeFlags]) {
        if (flags.length === 0) continue;
        const option = new Option(flags.join(", "), parameter.description);
        command.addOption(option);
        mappings.push({
          parameterName: parameter.parameterName,
          attribute: option.attributeName(),
        });
      }
      continue;
    }
    const option = new Option(
      `${parameter.flags.join(", ")} <${parameter.valueName}>`,
      parameter.description,
    );
    if (parameter.valueMode !== CLI_OPTION_VALUE_MODE.replace) {
      option.argParser((value, previous: string[] = []) => [
        ...previous,
        value,
      ]);
    }
    command.addOption(option);
    mappings.push({
      parameterName: parameter.parameterName,
      attribute: option.attributeName(),
    });
  }
  return mappings;
}

const cliResults: SearchResult[] = [];
const cliRawInputs: Record<string, unknown>[] = [];
function registerCliNode(node: typeof cliTree.root, command: Command): void {
  command.description(node.description);
  node.commands.forEach((spec) => {
    const mappings = addCliOptions(command, spec);
    command.action(async () => {
      const explicit: Record<string, unknown> = Object.fromEntries(
        mappings
          .filter(
            (mapping) =>
              command.getOptionValueSource(mapping.attribute) === "cli",
          )
          .map((mapping) => [
            mapping.parameterName,
            command.getOptionValue(mapping.attribute),
          ]),
      );
      cliRawInputs.push(explicit);
      const input = spec.input.parseOptions(explicit);
      cliResults.push(await spec.handler(input, { caller: "cli" }));
    });
  });
  for (const child of node.children) {
    registerCliNode(child, command.command(child.token));
  }
}

function createCliProgram(): Command {
  const program = new Command()
    .name(cliTree.root.token)
    .exitOverride()
    .enablePositionalOptions()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerCliNode(cliTree.root, program);
  return program;
}

before = snapshotCalls();
await createCliProgram().parseAsync(
  ["-q", "root", "--no-feature", "--tag", "one,two", "-t", "three"],
  { from: "user" },
);
assert.deepEqual(cliResults.at(-1), {
  caller: "cli",
  query: "root",
  limit: 2,
  feature: false,
  tags: ["one", "two", "three"],
  settingBeforeMutation: "fresh",
  hiddenNote: null,
  hiddenMode: "private",
});
assert.equal(cliRawInputs.at(-1)?.feature, false);
assertOneInvocation(before);

before = snapshotCalls();
await createCliProgram().parseAsync(["tools", "search", "--query", "child"], {
  from: "user",
});
assert.equal(cliResults.at(-1)?.feature, true);
assert.equal(cliResults.at(-1)?.settingBeforeMutation, "fresh");
assert.equal(Object.hasOwn(cliRawInputs.at(-1) ?? {}, "feature"), false);
assertOneInvocation(before);
assert.equal(createCliProgram().commands[0]?.name(), "tools");
assert.equal(createCliProgram().commands[0]?.commands[1]?.name(), "empty");

before = snapshotCalls();
await createCliProgram().parseAsync(["find", "--query", "second-path"], {
  from: "user",
});
assert.equal(cliResults.at(-1)?.query, "second-path");
assertOneInvocation(before);
await assert.rejects(
  createCliProgram().parseAsync(["find", "--query", "x", "--limit", "bad"], {
    from: "user",
  }),
  EntryInputError,
);
await assert.rejects(
  createCliProgram().parseAsync(["--query", "x", "--unknown"], {
    from: "user",
  }),
);
await assert.rejects(
  createCliProgram().parseAsync(["--query", "x", "--hidden-note", "inject"], {
    from: "user",
  }),
);

const placementPaths: string[][] = [];
function collectPlacementPaths(node: typeof cliTree.root): void {
  node.commands.forEach((command) => {
    placementPaths.push([...command.path]);
  });
  for (const child of node.children) collectPlacementPaths(child);
}
collectPlacementPaths(cliTree.root);
assert.deepEqual(placementPaths, [[], ["tools", "search"], ["find"]]);
const placementIndex = new Set(
  placementPaths.map((path) => JSON.stringify(path)),
);
const endpointOnlyIndex = new Set([
  SearchEndpoint,
  SearchEndpoint,
  SearchEndpoint,
]);
assert.equal(placementIndex.size, 3);
assert.equal(endpointOnlyIndex.size, 1);
assert.notEqual(placementIndex.size, endpointOnlyIndex.size);

const PositionalEndpoint = defineEntryEndpoint(SearchEntry, {
  handler: search,
  channels: [
    bindCliEntry({
      parameters: [
        { kind: "positional", parameterName: "query" },
        { kind: "option", parameterName: "limit" },
        { kind: "option", parameterName: "feature" },
        { kind: "option", parameterName: "tags" },
        { kind: "option", parameterName: "settings", coercion: "json" },
      ],
    }),
  ],
});
const unsupportedView = collectCliCommands(
  defineEntryNode({
    name: "positional",
    description: "Unsupported by this example adapter",
    endpoints: [PositionalEndpoint],
  }),
);
unsupportedView.root.children[0]?.commands.forEach((spec) => {
  assert.throws(
    () => addCliOptions(new Command(), spec),
    /supports option bindings only/u,
  );
});
console.log(
  "PASS CLI: actual Commander parseAsync, aliases/repeat/default/false, parent+children/empty group",
);
console.log(
  "PASS CLI negative: unsupported positional binding is rejected, not dropped",
);

const server = new McpServer({ name: "channels-consumer", version: "1.0.0" });
mcpTools.forEach((tool) => {
  server.registerTool(
    tool.name,
    { description: tool.entry.name, inputSchema: tool.input.schema },
    async (values) => {
      const input = tool.input.project(values);
      const result = await tool.handler(input, { caller: "mcp" });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.registerTool(
    `${tool.name}_double_parse_negative`,
    { inputSchema: tool.input.schema },
    async (values) => {
      tool.input.parse(values);
      return { content: [{ type: "text", text: "unexpected success" }] };
    },
  );
});

const client = new Client({ name: "channels-test", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
try {
  const listed = await client.listTools();
  const listedTool = listed.tools.find(
    (tool) => tool.name === "catalog_search",
  );
  assert.ok(listedTool);
  const schema = listedTool.inputSchema;
  const limitSchema = schema.properties?.limit;
  assert.ok(limitSchema && "default" in limitSchema);
  assert.equal(limitSchema.default, "2");
  assert.equal(schema.required?.includes("limit"), false);
  assert.equal(Object.hasOwn(schema.properties ?? {}, "hiddenNote"), false);
  assert.equal(Object.hasOwn(schema.properties ?? {}, "hiddenMode"), false);

  before = snapshotCalls();
  const result = await client.callTool({
    name: "catalog_search",
    arguments: { query: "sdk" },
  });
  assert.deepEqual(result.structuredContent, {
    caller: "mcp",
    query: "sdk",
    limit: 2,
    feature: true,
    tags: [],
    settingBeforeMutation: "fresh",
    hiddenNote: null,
    hiddenMode: "private",
  });
  assertOneInvocation(before);

  before = snapshotCalls();
  const invalid = await client.callTool({
    name: "catalog_search",
    arguments: { query: "sdk", unknown: true },
  });
  assert.equal(invalid.isError, true);
  assert.equal(calls.project, before.project);
  assert.equal(calls.handler, before.handler);

  before = snapshotCalls();
  const excluded = await client.callTool({
    name: "catalog_search",
    arguments: { query: "sdk", hiddenMode: "inject" },
  });
  assert.equal(excluded.isError, true);
  assert.equal(calls.project, before.project);
  assert.equal(calls.handler, before.handler);

  before = snapshotCalls();
  const doubleParse = await client.callTool({
    name: "catalog_search_double_parse_negative",
    arguments: { query: "sdk" },
  });
  assert.equal(doubleParse.isError, true);
  assert.equal(calls.project, before.project);
  assert.equal(calls.handler, before.handler);
  console.log(
    "PASS MCP: SDK 1.30 in-memory listTools/callTool, schema default, project-only callback",
  );
  console.log("PASS negative: re-parsing SDK-transformed MCP values fails");
} finally {
  await client.close();
  await server.close();
}

const greetingHttpResponse =
  await createGreetingHttpApp().request("/greet?name=Ada");
assert.equal(greetingHttpResponse.status, 200);
const greetingHttpOutput = await greetingHttpResponse.json();
assert.deepEqual(greetingHttpOutput, { message: "Hello, Ada!" });

const greetingCliOutput: string[] = [];
await createGreetingCliProgram((message) => greetingCliOutput.push(message))
  .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  .parseAsync(["greet", "--name", "Ada"], { from: "user" });
assert.deepEqual(greetingCliOutput, ["Hello, Ada!"]);

const greetingServer = createGreetingMcpServer();
const greetingClient = new Client({ name: "greeting-test", version: "1.0.0" });
const [greetingClientTransport, greetingServerTransport] =
  InMemoryTransport.createLinkedPair();
await greetingServer.connect(greetingServerTransport);
await greetingClient.connect(greetingClientTransport);
let greetingMcpOutput: string | undefined;
try {
  const listed = await greetingClient.listTools();
  assert.ok(listed.tools.some((tool) => tool.name === "greet"));
  const result = await greetingClient.callTool({
    name: "greet",
    arguments: { name: "Ada" },
  });
  const content: unknown = result.content;
  assert.ok(Array.isArray(content));
  const text = content.find(
    (item: unknown): item is { readonly type: "text"; readonly text: string } =>
      typeof item === "object" &&
      item !== null &&
      Reflect.get(item, "type") === "text" &&
      typeof Reflect.get(item, "text") === "string",
  );
  assert.ok(text);
  greetingMcpOutput = text.text;
  assert.equal(greetingMcpOutput, "Hello, Ada!");
} finally {
  await greetingClient.close();
  await greetingServer.close();
}
console.log(
  "PASS canonical packed greeting:",
  JSON.stringify({
    http: greetingHttpOutput,
    mcp: greetingMcpOutput,
    cli: greetingCliOutput,
  }),
);

console.log("PASS external consumer runtime");
