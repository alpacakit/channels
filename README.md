# @alpacakit/channels

Define an operation once and expose it as a CLI command, an HTTP route and an MCP tool. channels describes each operation's input and binds the same handler to each channel. Your application keeps its own argv parser, HTTP framework and MCP SDK, and does the registration, response formatting and error reporting.

## Install

The package is in beta: any release may change the interface. Install an exact version.

```sh
npm install --save-exact @alpacakit/channels@<version> zod
```

Requires Node 22.19 or later and zod 4.

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

Complete examples with Hono, the MCP SDK and Commander are in [examples/](examples/README.md).

## Entry points

- `@alpacakit/channels`: entries, parameters, codecs, endpoints and trees
- `@alpacakit/channels/cli`: CLI bindings and `collectCliCommands`
- `@alpacakit/channels/http`: HTTP bindings and `collectHttpRoutes`
- `@alpacakit/channels/mcp`: MCP bindings and `collectMcpTools`

## License

[MIT License](LICENSE)
