# External-adapter examples

[`greeting.ts`](./greeting.ts) is the canonical copy-ready Hono, MCP SDK, and
Commander example. The packed-distribution verifier copies this exact shipped
file, type-checks it, and invokes all three host paths so the documentation and
executable fixture cannot drift apart.

## Book search

[`book-search.ts`](./book-search.ts) defines one Entry, one shared handler, one
Endpoint, and one Tree. `collectCliCommands`, `collectHttpRoutes`, and
`collectMcpTools` expose registration views for an application-owned parser,
router, or SDK.

The example deliberately does not parse argv, start a server, open an MCP
transport, choose response envelopes, or manage process exit. Those jobs belong
to the host. It does show the two valid input paths:

- CLI and HTTP convert their external string forms with `parseOptions` and
  `parseQuery`.
- An MCP SDK can apply `input.schema` and then call `input.project` exactly
  once. A host without SDK validation can call `input.parse` instead.

All three views retain the exact `searchBooks` function reference and require
the host-created `BookSearchContext` at invocation time.

Host adapters deliberately live in the consumer: channels never starts a
server, connects a transport, parses `argv`, or chooses a response envelope.
