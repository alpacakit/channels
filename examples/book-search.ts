import {
  codecs,
  createOutputContract,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  optional,
  required,
  verifyEntryOutput,
} from "@alpacakit/channels";
import {
  bindCliEntry,
  CLI_ARG_KIND,
  collectCliCommands,
} from "@alpacakit/channels/cli";
import { bindHttpEntry, collectHttpRoutes } from "@alpacakit/channels/http";
import { bindMcpEntry, collectMcpTools } from "@alpacakit/channels/mcp";
import { z } from "zod";

const BookSearchDataSchema = z
  .object({
    books: z.array(
      z.object({ id: z.string(), title: z.string(), author: z.string() }),
    ),
  })
  .readonly();

export type BookSearchData = z.output<typeof BookSearchDataSchema>;
export type Book = BookSearchData["books"][number];

export const BookSearchEntry = defineEntry({
  name: "book-search",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Text to find in a title or author",
    }),
    defineParameter({
      name: "limit",
      codec: codecs.positiveInteger({ max: 50 }),
      requirement: optional({ default: 10 }),
      description: "Maximum number of books to return",
    }),
  ],
  project: ({ values }) => ({ query: values.query, limit: values.limit }),
  output: createOutputContract(BookSearchDataSchema),
});

export type BookSearchInput = ReturnType<typeof BookSearchEntry.project>;
export type BookSearchContext = {
  readonly canSearch: boolean;
  readonly findBooks: (query: string) => Promise<readonly Book[]>;
};

export type BookSearchOutcome =
  | { readonly kind: "found"; readonly data: BookSearchData }
  | { readonly kind: "forbidden" };

/** The shared business handler; channel collectors retain this exact reference. */
export async function searchBooks(
  input: BookSearchInput,
  context: BookSearchContext,
): Promise<BookSearchOutcome> {
  if (!context.canSearch) {
    return { kind: "forbidden" };
  }
  const books = await context.findBooks(input.query);
  return {
    kind: "found",
    data: verifyEntryOutput(BookSearchEntry, {
      books: books.slice(0, input.limit),
    }),
  };
}

export const BookSearchEndpoint = defineEntryEndpoint(BookSearchEntry, {
  handler: searchBooks,
  channels: [
    bindCliEntry({
      parameters: [
        { kind: CLI_ARG_KIND.positional, parameterName: "query" },
        { kind: CLI_ARG_KIND.option, parameterName: "limit" },
      ],
    }),
    bindMcpEntry({ name: "books_search" }),
    bindHttpEntry({ method: "GET" }),
  ],
});

export const BookSearchTree = defineEntryTree(
  defineEntryNode({
    name: "books",
    description: "Book catalog",
    children: [
      defineEntryNode({
        name: "search",
        description: "Search books",
        endpoints: [BookSearchEndpoint],
      }),
    ],
  }),
);

export const bookSearchCliCommands = collectCliCommands(BookSearchTree);
export const bookSearchHttpRoutes = collectHttpRoutes(BookSearchTree);
export const bookSearchMcpTools = collectMcpTools(BookSearchTree);

/**
 * A small host-owned invocation demonstration. Real applications register the
 * same views with their CLI parser, HTTP router, and MCP SDK.
 */
export async function runBookSearchDemo(): Promise<{
  readonly cli: BookSearchOutcome;
  readonly http: BookSearchOutcome;
  readonly mcp: BookSearchOutcome;
}> {
  const context: BookSearchContext = {
    canSearch: true,
    findBooks: async () => [
      {
        id: "1",
        title: "The Left Hand of Darkness",
        author: "Ursula K. Le Guin",
      },
      { id: "2", title: "Kindred", author: "Octavia E. Butler" },
    ],
  };
  const tasks: Promise<BookSearchOutcome>[] = [];
  bookSearchCliCommands.root.children[0]?.commands.forEach((command) => {
    const input = command.input.parseOptions({ query: "kind", limit: "1" });
    tasks.push(Promise.resolve(command.handler(input, context)));
  });
  bookSearchHttpRoutes.forEach((route) => {
    const input = route.input.parseQuery({ query: "kind", limit: "1" });
    tasks.push(Promise.resolve(route.handler(input, context)));
  });
  bookSearchMcpTools.forEach((tool) => {
    const values = tool.input.schema.parse({ query: "kind", limit: 1 });
    const input = tool.input.project(values);
    tasks.push(Promise.resolve(tool.handler(input, context)));
  });
  const [cli, http, mcp] = await Promise.all(tasks);
  if (cli === undefined || http === undefined || mcp === undefined) {
    throw new Error("Book search adapters were not collected");
  }
  return { cli, http, mcp };
}
