# @alpacakit/channels

Define an operation once and expose it as a CLI command, an HTTP route and an MCP tool. channels describes each operation's input and binds the same handler to each channel. Your application keeps its own argv parser, HTTP framework and MCP SDK, and does the registration, response formatting and error reporting.

## Install

The package is in beta: any release may change the interface. Install an exact version.

```sh
npm install --save-exact @alpacakit/channels@<version> zod
```

Requires Node 22.19 or later and zod 4.3.6 or later.

## Example

```ts
import { codecs, defineEntry, defineEntryEndpoint, defineEntryNode, defineEntryTree, defineParameter, optional } from "@alpacakit/channels";
import { bindHttpEntry, collectHttpRoutes } from "@alpacakit/channels/http";
import { bindMcpEntry, collectMcpTools } from "@alpacakit/channels/mcp";

const GreetEntry = defineEntry({
  name: "greet",
  parameters: [
    defineParameter({ name: "name", codec: codecs.string(), requirement: optional({ default: "world" }), description: "Person to greet" }),
  ],
  project: ({ values }) => ({ name: values.name }),
});

const GreetEndpoint = defineEntryEndpoint(GreetEntry, {
  handler: (input: { name: string }) => ({ message: `Hello, ${input.name}!` }),
  channels: [bindHttpEntry({ method: "GET" }), bindMcpEntry({ name: "greet" })],
});

const AppTree = defineEntryTree(
  defineEntryNode({
    name: "demo",
    description: "Greeting example",
    children: [defineEntryNode({ name: "greet", description: "Greet someone", endpoints: [GreetEndpoint] })],
  }),
);

// Register these on your own router and MCP server.
collectHttpRoutes(AppTree).forEach(async (route) => {
  const input = route.input.parseQuery({ name: "Ada" });
  console.log(route.method, route.path, await route.handler(input));
}); // GET /greet { message: 'Hello, Ada!' }
collectMcpTools(AppTree).forEach((tool) => console.log(tool.name)); // greet
```

A complete example with Hono, the MCP SDK and Commander, including the CLI side (`collectCliCommands`), is in [examples/greeting.ts](https://github.com/alpacakit/channels/blob/main/examples/greeting.ts). [examples/](https://github.com/alpacakit/channels/blob/main/examples/README.md) has one more.

## JSON parameters

Use `codecs.json(schema)` with a Zod schema such as
`z.object({ steps: z.array(z.string()) })`, or use `z.json()` to accept any JSON value.

- CLI: pass one JSON argument, for example `--plan '{"steps":["build"]}'`.
- HTTP: use `route.input.parse` on the decoded POST body, for example
  `{"plan":{"steps":["build"]}}`. `collectHttpRoutes` rejects GET routes that expose JSON parameters.
- MCP: use `z.toJSONSchema(tool.input.schema, { io: "input" })` to publish the schema for the tool's arguments.

## Entry points

- `@alpacakit/channels`: entries, parameters, codecs, endpoints, trees and `EntryInputError`
- `@alpacakit/channels/cli`: CLI bindings and `collectCliCommands`
- `@alpacakit/channels/http`: HTTP bindings and `collectHttpRoutes`
- `@alpacakit/channels/mcp`: MCP bindings and `collectMcpTools`

## License

[MIT License](https://github.com/alpacakit/channels/blob/main/LICENSE)
