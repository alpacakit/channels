// Consumer-owned adapters over the implemented public collectors.
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  EntryInputError,
  optional,
} from "@alpacakit/channels";
import { bindCliEntry, collectCliCommands } from "@alpacakit/channels/cli";
import { bindHttpEntry, collectHttpRoutes } from "@alpacakit/channels/http";
import { bindMcpEntry, collectMcpTools } from "@alpacakit/channels/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Command, CommanderError, Option } from "commander";
import { Hono } from "hono";

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

export function createHttpApp() {
  const app = new Hono();
  collectHttpRoutes(AppTree).forEach((route) => {
    app.on(route.method, route.path, async (context) => {
      const input = route.input.parseQuery(context.req.queries());
      const result = await route.handler(input, { greeting: "Hello" });
      return context.json(result);
    });
  });
  app.onError((error, context) => {
    if (error instanceof EntryInputError) {
      return context.json({ error: "Check your input" }, 400);
    }
    console.error(error);
    return context.json({ error: "Operation failed" }, 500);
  });
  return app;
}

export function createMcpServer() {
  const server = new McpServer({ name: "demo", version: "1.0.0" });
  collectMcpTools(AppTree).forEach((tool) => {
    server.registerTool(
      tool.name,
      { inputSchema: tool.input.schema },
      async (values) => {
        try {
          // The SDK has already validated and transformed these values.
          const input = tool.input.project(values);
          const result = await tool.handler(input, { greeting: "Hello" });
          return { content: [{ type: "text", text: result.message }] };
        } catch (error) {
          const expected = error instanceof EntryInputError;
          if (!expected) {
            console.error(error);
          }
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: expected ? "Check your input" : "Operation failed",
              },
            ],
          };
        }
      },
    );
  });
  return server;
}

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

export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    await createCliProgram().parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof EntryInputError) {
      console.error("Check your input");
      process.exitCode = 2;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  }
}

// CLI entrypoint: await runCli(process.argv.slice(2));
// HTTP host: mount createHttpApp() in the existing Hono application.
// MCP host: await createMcpServer().connect(theChosenTransport);
