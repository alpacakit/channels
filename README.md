# @alpacakit/channels

`@alpacakit/channels` defines shared operations and derives registration views
for application-owned CLI, HTTP, and MCP hosts. It does not own argv parsing,
network servers, SDK transports, handler registries, response formatting, or
resource lifetime.

## Public entry points

- `@alpacakit/channels`: Entry, Parameter, codec, Endpoint, Node/Tree,
  introspection, input errors, and optional output verification.
- `@alpacakit/channels/cli`: CLI bindings and `collectCliCommands`.
- `@alpacakit/channels/http`: HTTP bindings and `collectHttpRoutes`.
- `@alpacakit/channels/mcp`: MCP bindings and `collectMcpTools`.

The package has no MCP SDK, Hono, Express, or Commander dependency. Hosts use
the neutral registration views with the framework version they own.

## Quick start: one handler, three channels

Define the input once, attach the shared operation as the Endpoint's `handler`,
and collect the Tree in the application that owns each host. The following
sections use the same `AppTree`; each host is independent.

```ts
import {
  codecs, defineEntry, defineEntryEndpoint, defineEntryNode,
  defineEntryTree, defineParameter, optional,
} from "@alpacakit/channels";
import { bindCliEntry, collectCliCommands } from "@alpacakit/channels/cli";
import { bindHttpEntry, collectHttpRoutes } from "@alpacakit/channels/http";
import { bindMcpEntry, collectMcpTools } from "@alpacakit/channels/mcp";

export const GreetEntry = defineEntry({
  name: "greet",
  parameters: [
    defineParameter({
      name: "name",
      codec: codecs.string(),
      requirement: optional({ default: "world" }),
      description: "Person to greet",
    }),
  ],
  project: ({ values }) => ({ name: values.name }),
});

export type GreetingContext = {
  readonly greeting: string;
};

export function greet(
  input: ReturnType<typeof GreetEntry.project>,
  context: GreetingContext,
) {
  return { message: `${context.greeting}, ${input.name}!` };
}

export const GreetEndpoint = defineEntryEndpoint(GreetEntry, {
  handler: greet,
  channels: [
    bindHttpEntry({ method: "GET" }),
    bindMcpEntry({ name: "greet" }),
    bindCliEntry({
      parameters: [{ kind: "option", parameterName: "name" }],
    }),
  ],
});

export const AppTree = defineEntryTree(
  defineEntryNode({
    name: "demo",
    description: "Greeting example",
    children: [
      defineEntryNode({
        name: "greet",
        description: "Greet someone",
        endpoints: [GreetEndpoint],
      }),
    ],
  }),
);
```

`GreetEndpoint.handler === greet`. The first argument to `defineEntryEndpoint`
is the Entry definition; `handler` is the function the host callback calls.
Bindings describe how to expose the operation and do not contain another
handler. Definition and collection never invoke it or create its context.

The second handler argument is your own context: here it contains `greeting`,
but it can contain a service, authenticated user, or cancellation signal. Create
it inside the host callback when its dependencies are available. A handler that
needs no context can accept only the projected input. Handlers may take zero,
one, or two parameters; rest and three-or-more-parameter signatures are rejected
by TypeScript.

### HTTP with Hono

Install Hono in the consuming application. Register each route on an existing
Hono app, use its request API, and choose its response format yourself:

```ts
import { Hono } from "hono";

const app = new Hono();
collectHttpRoutes(AppTree).forEach((route) => {
  app.on(route.method, route.path, async (context) => {
    const input = route.input.parseQuery(context.req.queries());
    const result = await route.handler(input, { greeting: "Hello" });
    return context.json(result);
  });
});
```

`GET /greet?name=Ada` produces `{ "message": "Hello, Ada!" }`.
For JSON bodies, pass the object from your framework to `route.input.parse`
instead. Authentication, middleware, server startup, and response handling stay
in the application; the same registration views also work with Express or
another router.

### MCP with the MCP SDK

Install the MCP SDK in the consuming application and use your own server and
transport:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "demo", version: "1.0.0" });
collectMcpTools(AppTree).forEach((tool) => {
  server.registerTool(
    tool.name,
    { inputSchema: tool.input.schema },
    async (values) => {
      // The SDK has already validated and transformed the public values.
      const input = tool.input.project(values);
      const result = await tool.handler(input, { greeting: "Hello" });
      return { content: [{ type: "text", text: result.message }] };
    },
  );
});
// Connect `server` to the transport chosen by your application.
```

Calling tool `greet` with `{ "name": "Ada" }` returns the greeting as MCP text.
Use `project`, not `parse`, after SDK validation so defaults and transforms are
not applied twice. The SDK's callback also lets the application use MCP request
metadata or cancellation when constructing the shared handler's context.

### CLI with Commander

Install Commander in the consuming application. Walk the collected tree to
create groups and commands once, then call the shared handler from each action.
This adapter covers the value-taking options used by the example:

```ts
import { Command, Option } from "commander";

export function createCliProgram(
  writeMessage: (message: string) => void = console.log,
) {
  const view = collectCliCommands(AppTree);
  const program = new Command()
    .name(view.root.token)
    .exitOverride()
    .enablePositionalOptions();

  function register(node: typeof view.root, command: Command): void {
    command.description(node.description);
    node.commands.forEach((spec) => {
      // This example tree only uses value-taking options.
      const mappings = spec.parameters.map((parameter) => {
        if (parameter.kind !== "option" || parameter.optionKind !== "value") {
          throw new Error("This example only handles value-taking options");
        }
        const option = new Option(
          `${parameter.flags.join(", ")} <${parameter.valueName}>`,
          parameter.description,
        );
        command.addOption(option);
        return {
          name: parameter.parameterName,
          attribute: option.attributeName(),
        };
      });
      command.action(async () => {
        const raw = Object.fromEntries(
          mappings
            .filter(
              (mapping) =>
                command.getOptionValueSource(mapping.attribute) === "cli",
            )
            .map((mapping) => [
              mapping.name,
              command.getOptionValue(mapping.attribute),
            ]),
        );
        const input = spec.input.parseOptions(raw);
        const result = await spec.handler(input, { greeting: "Hello" });
        writeMessage(result.message);
      });
    });
    for (const child of node.children) {
      register(child, command.command(child.token));
    }
  }

  register(view.root, program);
  return program;
}

const program = createCliProgram();
// In your CLI entrypoint:
// await program.parseAsync(process.argv.slice(2), { from: "user" });
```

Running `demo greet --name Ada` prints `Hello, Ada!`. Omitting `--name` uses
`world`. The recursive registration retains group-only nodes and executable
parents with children. If your tree uses positionals or flags, register those
from `spec.parameters` using your parser's corresponding APIs. Existing CLI
parsers can use the same views; Commander is only this example's host.

The complete [greeting example](./examples/greeting.ts), including process error
handling, is shipped with the package and compiled and invoked from its packed
artifact. The [book-search example](./examples/book-search.ts) also demonstrates
a typed output contract and domain outcome union.

## Input and failure handling

| Host input | Method | Work performed |
| --- | --- | --- |
| CLI values explicitly supplied by the user | `input.parseOptions(raw)` | String coercion, validation/defaults, then Entry projection |
| HTTP query strings or string arrays | `input.parseQuery(raw)` | Query coercion, validation/defaults, then Entry projection |
| Unvalidated JSON object | `input.parse(raw)` | Validation/defaults, then Entry projection |
| Values already validated by `input.schema` | `input.project(values)` | Entry projection and hidden defaults, without revalidating public values |

The host decides how to report invalid input and operation failures. Catch
`EntryInputError` around the input-processing call when mapping it to HTTP 400,
a CLI usage error, or an MCP error result. Keep the handler call outside that
catch: an exception from the operation or its dependencies is a separate
failure, even if it has the same error class. Response envelopes, logging,
resource cleanup, and process exit remain application responsibilities.

`parseOptions` must receive only canonical parameter names explicitly supplied
by the user. Do not pass defaults inserted by the external parser.
`parseQuery` accepts a scalar string or one-element string array, rejects
duplicate scalar values, and treats a scalar value for an array parameter as a
one-element array. `input.parse` is the JSON-value path and performs no CLI or
query string coercion.

`input.schema` performs public parameter validation, authored raw defaults, and
codec transforms. It never performs Entry projection. After an SDK validates
with that schema, call `input.project` once; otherwise call `input.parse` once.
Authored defaults are represented by the public schema (including input-mode
JSON Schema conversion) before codec transforms, and are copied for each
invocation, including object and array defaults. Non-object JSON containers are
rejected as `EntryInputError` by every parse path.

## Tree placement

A Tree root is a container: its CLI path is `[]`, its HTTP path is `/`, and its
CLI token is the program display name. Collecting a Node directly creates a
virtual CLI root and includes the Node's own segment (`[token]` and
`/segment`). Empty and group-only nodes remain visible in the CLI view.

Use `mergeEntryTreeNodes` to explicitly merge compatible same-name nodes.
Collectors deduplicate the same Endpoint at the same placement, retain the same
Endpoint at different CLI/HTTP paths, and emit one MCP tool per Endpoint.
Cycles, conflicting paths, invalid segments, duplicate channel bindings,
unreachable required parameters, and HTTP/MCP/CLI ownership collisions throw
`EntryTreeDefinitionError` before a host registers anything.

See the shipped [examples guide](./examples/README.md) for the two examples and
the division of responsibility between channels and the host.
