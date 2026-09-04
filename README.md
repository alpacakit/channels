# @alpacakit/channels

Define an entry once, bind it to CLI, MCP, and HTTP, and use the same typed
endpoint for argument parsing, help, MCP schemas, HTTP routing, input decoding,
and projection.

## The mental model

You only need four concepts:

```text
Entry    = what the command accepts and what it projects
Binding  = how one channel supplies that input
Endpoint = the Entry and its Bindings bundled together
Tree     = where the Endpoint lives in the surface hierarchy
```

A useful shorthand is:

```text
What?        -> Entry
How?         -> Binding
Where?       -> Tree
Bundle them  -> Endpoint
```

Suppose an application exposes this CLI command:

```console
my-app hint "entry tree" --limit 5
```

The same operation is exposed to MCP with this JSON input:

```json
{
  "query": "entry tree",
  "limit": 5
}
```

And to HTTP as:

```http
GET /hint?query=entry%20tree&limit=5
```

The definitions have this structure:

```text
┌────────────────────────────────────────┐
│ Entry: HintEntry                       │
│                                        │
│ query: required string                 │
│ limit: optional integer, default 20    │
│                                        │
│ project the values into a HintRequest  │
└───────────────────┬────────────────────┘
                    │
                    │ attach channel input mappings
                    ▼
┌────────────────────────────────────────┐
│ Endpoint: HintEndpoint                 │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ CLI Binding                        │ │
│ │ query -> positional argument       │ │
│ │ limit -> --limit / -n              │ │
│ └────────────────────────────────────┘ │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ MCP Binding                        │ │
│ │ query -> JSON property "query"     │ │
│ │ limit -> JSON property "limit"     │ │
│ └────────────────────────────────────┘ │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ HTTP Binding                       │ │
│ │ method -> GET                      │ │
│ │ expose query and limit             │ │
│ └────────────────────────────────────┘ │
└───────────────────┬────────────────────┘
                    │
                    │ place the endpoint at an address
                    ▼
┌────────────────────────────────────────┐
│ Tree                                   │
│                                        │
│ my-app                                 │
│ └── hint                               │
│     └── HintEndpoint                   │
└────────────────────────────────────────┘
```

The important rule is that value types, validation, requiredness, defaults, and
projection are declared only on the Entry. A Binding only says how a channel
supplies a parameter. A Tree only says where an Endpoint lives.

The following sections build that example from top to bottom.

## 1. Define what the command does: Entry

An Entry answers four questions:

```text
What values does this operation accept?
                ↓
How are those values validated?
                ↓
Which defaults are applied?
                ↓
What application value is produced?
```

```ts
import {
  codecs,
  defineEntry,
  defineParameter,
  optional,
  required,
} from "@alpacakit/channels";

const HintEntry = defineEntry({
  name: "hint",

  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Text to search for",
    }),

    defineParameter({
      name: "limit",
      codec: codecs.positiveInteger({ max: 100 }),
      requirement: optional({ default: 20 }),
      description: "Maximum number of hints",
    }),
  ],

  project: ({ values }) => ({
    query: values.query,
    limit: values.limit,
  }),
});
```

In plain English, this Entry means:

```text
hint

Input:
  query
    - string
    - required

  limit
    - positive integer
    - at most 100
    - defaults to 20

Projection:
  {
    query: string,
    limit: number
  }
```

There is no CLI, MCP, or HTTP logic here. The Entry describes the operation
itself.

Because `limit` has a default, `values.limit` is typed as `number`, not
`number | undefined`. Only optional parameters without a default remain
optional in `values`.

## 2. Define how each channel supplies input: Bindings

A CLI Binding maps the Entry parameters to argv syntax:

```ts
import { bindCliEntry } from "@alpacakit/channels/cli";

const HintCliBinding = bindCliEntry({
  parameters: [
    { kind: "positional", parameterName: "query" },
    { kind: "option", parameterName: "limit", flags: ["--limit", "-n"] },
  ],
});
```

A binding row only needs `kind` and `parameterName`. The rest is derived from
the parameter name and only stated when you want to override it:

- `query` needs no `valueName` (help shows `QUERY`) and no `variadic` (defaults
  to `false`).
- `limit` would default to the single flag `--limit`; here `flags` is given
  only to add the `-n` alias.

The mapping is:

```text
my-app hint "entry tree" --limit 5
             └────┬────┘ └───┬───┘
                  │            │
                  ▼            ▼
                query        limit
```

Do not repeat `query`'s string codec or `limit`'s default in the Binding. Those
facts already belong to the Entry.

An MCP Binding exposes every Entry parameter as tool input unless it is listed
in `exclude`:

```ts
import { bindMcpEntry } from "@alpacakit/channels/mcp";

const HintMcpBinding = bindMcpEntry();
```

The mapping is:

```text
{
  "query": "entry tree",
  "limit": 5
}
     │            │
     ▼            ▼
   query        limit
```

An HTTP Binding selects the safe default method (`POST`), or overrides it, and
can hide parameters in the same way:

```ts
import { bindHttpEntry, HTTP_METHOD } from "@alpacakit/channels/http";

const HintHttpBinding = bindHttpEntry({ method: HTTP_METHOD.get });
```

The Tree supplies the route and the Binding supplies the method:

```text
GET /hint?query=entry%20tree&limit=5
    └─┬─┘ └──────────────┬──────────┘
      │                  │
      ▼                  ▼
 Tree path        Entry parameters
```

## 3. Bundle the Entry and Bindings: Endpoint

An Endpoint is the public execution identity for the operation:

```ts
import { defineEntryEndpoint } from "@alpacakit/channels";

const HintEndpoint = defineEntryEndpoint(
  HintEntry,
  HintCliBinding,
  HintMcpBinding,
  HintHttpBinding,
);
```

Its structure is:

```text
HintEndpoint
│
├── operation
│   └── HintEntry
│
├── CLI input mapping
│   ├── query is positional
│   └── limit is --limit / -n
│
├── MCP input mapping
│   ├── expose query
│   └── expose limit
│
└── HTTP input mapping
    ├── use GET
    └── expose query and limit
```

Keep the object returned by `defineEntryEndpoint()`. CLI result narrowing and
the MCP and HTTP runtime APIs use endpoint identity. Do not reconstruct an
equivalent Endpoint later.

## 4. Give the Endpoint an address: Tree

Place the Endpoint under the `hint` command:

```ts
import {
  defineEntryNode,
  defineEntryTree,
} from "@alpacakit/channels";

const CommandTree = defineEntryTree(
  defineEntryNode({
    name: "my-app",
    description: "My application",

    children: [
      defineEntryNode({
        name: "hint",
        description: "Find implementation hints",
        endpoints: [HintEndpoint],
      }),
    ],
  }),
);
```

The resulting hierarchy is:

```text
CommandTree

my-app                    <- root surface name
│
└── hint                  <- token that appears in argv
    │
    └── HintEndpoint      <- operation executed here
```

The root name is the program or surface name. It is not included in the argv
passed to the router.

Independent modules can contribute canonical nodes and merge them without an
intermediate route model:

```ts
const children = mergeEntryTreeNodes([
  ...configCommandNodes,
  ...integrationCommandNodes,
]);
```

Nodes with the same name are merged recursively. Their descriptions and
channel segment overrides must agree; identical endpoint objects are
deduplicated by identity.

An endpoint placed directly on the root is the default command:

```text
my-app
├── DefaultEndpoint       <- runs for []
└── hint
    └── HintEndpoint      <- runs for ["hint", ...]
```

## 5. Execute it from CLI

```ts
import {
  createCliRouter,
  isCliResolvedEndpoint,
} from "@alpacakit/channels/cli";

const router = createCliRouter(CommandTree);

const result = router.resolve([
  "hint",
  "entry tree",
  "--limit",
  "5",
]);

if (isCliResolvedEndpoint(result, HintEndpoint)) {
  console.log(result.projection);
}
```

The typed projection is:

```ts
{
  query: "entry tree",
  limit: 5,
}
```

At runtime the data flows through these stages:

```text
CLI argv
  │
  │ ["hint", "entry tree", "--limit", "5"]
  ▼
CLI Router
  │
  │ find HintEndpoint from the Tree
  ▼
CLI Binding
  │
  │ query = "entry tree"
  │ limit = "5"
  ▼
Shared Decoder
  │
  │ validate query as a string
  │ coerce and validate limit as an integer
  ▼
HintEntry.project()
  │
  ▼
{
  query: "entry tree",
  limit: 5
}
```

A stored Tree may contain many differently typed entries, so its endpoints are
deliberately type-erased. `isCliResolvedEndpoint()` checks endpoint identity and
restores the exact projection type for the selected Endpoint.

The same router also exposes a channel-derived help surface:

```ts
const help = router.help;
```

For applications with many endpoints, an optional typed registry replaces a
manual identity-check chain:

```ts
const executor = createCliExecutor(router, [
  handleCliEndpoint(HintEndpoint, ({ projection }) => runHint(projection)),
]);
```

The registry rejects duplicate, missing, and out-of-router endpoints when it is
created. Handlers, output policy, and process exit behavior remain outside the
Entry definition.

## 6. Execute the same Endpoint from MCP

Compile the Endpoint once, then reuse the handle for both registration and
per-invocation decoding:

```ts
import {
  createMcpEndpoint,
  isMcpResolved,
} from "@alpacakit/channels/mcp";

const HintMcpEndpoint = createMcpEndpoint(HintEndpoint);
```

`createMcpEndpoint()` validates the MCP binding once and returns a handle:

```text
HintMcpEndpoint
│
├── inputSchema   <- raw Zod object shape for tool registration
│
└── parse(raw)    <- decode + project one invocation
```

`inputSchema` is a raw Zod object shape suitable for MCP tool registration. It
contains descriptions, validation, and requiredness derived from `HintEntry`.

Decode and project an MCP invocation through the same handle:

```ts
const result = HintMcpEndpoint.parse({
  query: "entry tree",
  limit: 5,
});

if (isMcpResolved(result)) {
  console.log(result.projection);
}
```

Create the handle once (typically at startup) and reuse it for every request.
The binding is compiled a single time, so `parse()` does no per-invocation
recompilation, and an invalid binding throws `EntryTreeDefinitionError`
eagerly — exactly like `createCliRouter()`.

The MCP runtime path is:

```text
MCP JSON
  │
  │ { query: "entry tree", limit: 5 }
  ▼
HintEndpoint
  │
  ▼
MCP Binding
  │
  │ select query and limit
  ▼
Shared Decoder
  │
  │ validate both values
  ▼
HintEntry.project()
  │
  ▼
{
  query: "entry tree",
  limit: 5
}
```

If `limit` is omitted, MCP produces the Entry default:

```ts
{
  query: "entry tree",
  limit: 20,
}
```

## 7. Execute the same Endpoint from HTTP

Compile the Tree once, then resolve Fetch `Request` objects through it:

```ts
import {
  createHttpRouter,
  isHttpResolvedEndpoint,
} from "@alpacakit/channels/http";

const httpRouter = createHttpRouter(CommandTree);
const httpResult = await httpRouter.resolve(
  new Request("http://localhost/hint?query=entry%20tree&limit=5"),
);

if (isHttpResolvedEndpoint(httpResult, HintEndpoint)) {
  console.log(httpResult.projection);
}
```

The router derives `/hint` from the Tree, GET from the HTTP Binding, and the
input representation from each exposed Entry parameter:

```text
HTTP Request
  │
  │ GET /hint?query=entry%20tree&limit=5
  ▼
HTTP Router
  │
  │ find HintEndpoint from the Tree path and method
  ▼
HTTP Binding
  │
  │ query = "entry tree"
  │ limit = "5"
  ▼
Shared Decoder
  │
  │ coerce strings by Entry shape, then validate
  ▼
HintEntry.project()
  │
  ▼
{
  query: "entry tree",
  limit: 5
}
```

For direct request handling, register exactly one handler for every router
endpoint. A handler returns a JSON value or a Fetch `Response`:

```ts
import {
  createHttpHandler,
  handleHttpEndpoint,
} from "@alpacakit/channels/http";

const handle = createHttpHandler(httpRouter, [
  handleHttpEndpoint(HintEndpoint, ({ projection, request }) => ({
    query: projection.query,
    limit: projection.limit,
    requestId: request.headers.get("x-request-id"),
  })),
]);
```

Use the separate Node bridge when adapting `node:http` to Fetch objects:

```ts
import * as http from "node:http";
import { createNodeRequestListener } from "@alpacakit/channels/http/node";

const server = http.createServer(createNodeRequestListener(handle));
```

The bridge constructs a Fetch `Request` and writes the handler's Fetch
`Response`; creating, listening on, and closing the server remain application
policy.

All three channels converge on the same decoder, defaults, and projection:

```text
CLI argv ──> CLI Binding ───┐
                            │
MCP JSON ──> MCP Binding ───┼──> HintEndpoint
                            │          │
HTTP ─────> HTTP Binding ───┘          ▼
                                  Shared Decoder
                                        │
                                        ▼
                                HintEntry.project()
                                        │
                                        ▼
                                 same projection
```

If `limit` is omitted from any channel, each produces the Entry default.

## Where each decision belongs

When adding a command, ask these questions in order:

| Question | Definition |
| --- | --- |
| What values does the operation need? | Entry parameters |
| How are they validated and defaulted? | Entry codecs and requirements |
| What application value should be produced? | Entry `project()` |
| How does CLI supply each value? | CLI Binding |
| Which values does MCP expose or exclude? | MCP Binding |
| Which HTTP method is used and which values are hidden? | HTTP Binding |
| What object ties the operation and channels together? | Endpoint |
| Under which command or HTTP path does it live? | Tree and optional channel segment override |

Do not put CLI flags, MCP/HTTP exclusions, HTTP methods, or tree placement on
the Entry. Do not repeat codecs, requiredness, or defaults in Bindings.

## Suggested application file layout

For a larger application, separating these responsibilities keeps the model
easy to navigate:

```text
src/
├── hint-entry.ts
│   └── HintEntry
│       parameters, codecs, defaults, projection
│
├── hint-endpoint.ts
│   └── HintEndpoint
│       CLI, MCP, and HTTP Bindings
│
├── command-tree.ts
│   └── CommandTree
│       command hierarchy
│
├── cli.ts
│   └── createCliRouter(CommandTree)
│
├── mcp.ts
│   └── createMcpEndpoint(HintEndpoint)
│
└── http.ts
    └── createHttpRouter(CommandTree) and createHttpHandler(...)
```

## Package entries

The neutral model and channel adapters are intentionally separate imports:

| Import | Purpose |
| --- | --- |
| `@alpacakit/channels` | Parameters, codecs, entries, output contracts, and entry-tree builders |
| `@alpacakit/channels/cli` | CLI bindings/coercion, router, typed executor, help traversal, and text renderers |
| `@alpacakit/channels/mcp` | MCP binding, the compiled endpoint handle, output schema projection, and the resolved-result guard |
| `@alpacakit/channels/http` | HTTP binding, route derivation, Fetch router, typed handler registry, and resolved-result guard |
| `@alpacakit/channels/http/node` | `node:http` bridge for an HTTP Fetch handler |

`zod` is a peer dependency. In this workspace, depend on the package with
`workspace:*` and use the workspace Zod version.

## Parameter and codec reference

Built-in codecs are:

- `codecs.string()`
- `codecs.stringList()`
- `codecs.boolean()`
- `codecs.positiveInteger({ max })`
- `codecs.stringEnum(values)`
- `codecs.stringEnumList(values)`

Use `required()` for required input, `optional()` for an optional value without
a default, and `optional({ default })` for a materialized default.

Defaults belong to the Entry, not a channel. They are applied even when an
optional parameter is not exposed by the selected channel. A required parameter
must be reachable through every channel binding on that Endpoint.

`codecs.define({ schema, shape })` is available for advanced codecs. Its shape
is the CLI representation contract and must match the schema's value type.
Arrays are limited to supported scalar element shapes.

## CLI reference

Use `overrideCliSegment()` when the CLI spelling differs from the logical node
name:

```ts
import { overrideCliSegment } from "@alpacakit/channels/cli";

defineEntryNode({
  name: "hint",
  description: "Find implementation hints",
  segments: [overrideCliSegment({ token: "h" })],
  endpoints: [HintEndpoint],
});
```

CLI binding and routing rules:

- An option with no `flags` defaults to a single `--<kebab-case parameter
  name>` long flag. Provide `flags` only to add aliases or a short flag.
- A value-taking option's `valueName` defaults to the upper snake-cased
  parameter name. Boolean flags reject `valueName` because they take no value.
- A positional's `valueName` defaults to the upper snake-cased parameter name,
  and `variadic` defaults to `false`. State either only to override it.
- Options use reachable `-x` or `--long` flags. Requiredness comes from the
  Entry parameter, not the Binding.
- A defaulted boolean option is a flag by default. `negated: true` adds its
  generated `--no-...` long flags.
- A boolean without a default accepts an explicit value unless `booleanMode`
  selects another supported behavior.
- Array options may be repeated. `repeatMode: "comma_or_repeat"` also accepts
  comma-separated values.
- A variadic positional requires an array codec and must be the final
  positional.
- An executable node cannot have both positional arguments and child commands.
- `--` forces all remaining tokens to be parsed as positionals.
- A matching child command wins over an executable parent.
- `coercion: "json"` parses strict JSON before Entry validation.
  `coercion: "json_or_string"` preserves malformed JSON as text. Final value
  validation always belongs to the Entry codec.

`createCliRouter()` compiles and validates the complete CLI surface. Invalid
definitions throw `EntryTreeDefinitionError` at construction time.

The router's `help` property contains the compiled hierarchy, render-ready
option groups, positionals, requiredness, defaults, repeat modes, and generated
negative flags. Authored option-section names are resolved during
projection, so renderers consume `optionGroups` without performing a join.
`findCliHelpSurface()`, `listCliHelpSurfaces()`, `renderCliHelp()`, and
`formatCliRouterError()` provide standard lookup, traversal, one-surface text
rendering, and diagnostics without writing output or choosing an exit code.
`renderCliHelp()` implements `CliHelpRender`; its context carries the full
selected `programName`, root `executableName`, path, and description preference.
The renderer path uses canonical CLI segment tokens.
`--help`, complete-reference framing, and `--version` remain application policy.

The router returns a discriminated union:

- `resolved`
- `unknown_command`
- `incomplete_command`
- `invalid_input`
- `invalid_parameter`
- `internal_error`

`path` is preserved for diagnostics. Consumers may use the standard formatter
or supply their own wording. Process exit codes remain consumer policy.

## MCP reference

`createMcpEndpoint()` compiles the Endpoint once and returns the handle used for
both schema generation and runtime parsing. Do not keep a second runtime copy of
the MCP Binding.

`bindMcpEntry()` exposes every Entry parameter. List only exceptions when a
parameter must remain outside MCP:

```ts
const binding = bindMcpEntry({ exclude: ["internalOnly"] });
```

Excluding a nonexistent parameter, repeating an exclusion, or excluding a
required parameter is an `EntryTreeDefinitionError` at compilation.

```ts
declare const toolArguments: Record<string, unknown>;

const mcpEndpoint = createMcpEndpoint(HintEndpoint);
const inputShape = mcpEndpoint.inputSchema;
const result = mcpEndpoint.parse(toolArguments);
```

`inputSchema` is a raw Zod object shape. It includes every non-excluded
parameter in Entry order and projects its schema, description, and
requiredness.

`parse()` reads exposed keys, ignores other keys, applies Entry defaults to
omitted optional parameters (including excluded ones), validates input, and
runs the Entry projection. MCP SDK schema validation remains responsible for
rejecting keys absent from `inputSchema`. The parse result is:

- `resolved` with the typed projection
- `invalid_input` for an entry-targeted `EntryInputError` from `project()`
- `invalid_parameter` for a missing or invalid parameter, or a
  parameter-targeted `EntryInputError`
- `internal_error` with the original error for an unexpected `project()` throw

`isMcpResolved(result)` narrows a parse result to its `resolved` variant, the
MCP counterpart of `isCliResolvedEndpoint()`.

An invalid Endpoint binding throws `EntryTreeDefinitionError` from
`createMcpEndpoint()` itself, so definition errors surface at construction rather
than on the first invocation.

MCP tool naming and registration stay with the consumer. Hierarchical MCP tool
names are not currently derived from the Tree.

## HTTP reference

`createHttpRouter(tree, options)` eagerly derives and validates the complete
HTTP surface. Its `routes` array exposes each compiled method, path, path
segments, endpoint identity, and exposed parameter descriptions.

| Rule | Behavior |
| --- | --- |
| Route | The root name identifies the surface and is omitted. Each non-root Tree node contributes one literal segment; a root endpoint uses `/`. Matching is exact, including trailing slashes. |
| Segment override | `overrideHttpSegment({ segment })` changes only the HTTP segment. Segments accept RFC 3986 unreserved characters: letters, digits, `.`, `_`, `~`, and `-`. |
| Method | `bindHttpEntry()` defaults to `POST`. A read accidentally exposed as POST only loses cacheability; a write accidentally exposed as GET would violate HTTP semantics. Use `HTTP_METHOD.get` explicitly for reads. |
| GET input | Values come only from the query string; the body is ignored. Repeated keys supply array elements. Scalar repetition is invalid. Strings are coerced by Entry shape: `"true"`/`"false"` to booleans, integer strings to numbers, and scalar array values to arrays. |
| POST input | The body must have the `application/json` media type; media-type parameters and case are ignored. An empty body is `{}`. A nonempty body must be valid JSON whose root is an object. No string coercion is applied. |
| Exposure | Every Entry parameter is exposed unless named by `exclude`. Excluded optional parameters may still receive Entry defaults. Excluding a required parameter is a definition error. |
| Unknown keys | Query or JSON object keys outside the exposed parameters produce `invalid_input`; excluded keys are unknown to HTTP clients. |
| Body limit | `maxBodyBytes` defaults to 1,048,576 bytes. POST reading stops once the limit is exceeded. |
| Handler return | `handleHttpEndpoint()` handlers return a JSON value or a Fetch `Response`. A `Response` is passed through unchanged. |
| Output contract | A JSON value is checked against the Entry output contract when one exists. A violation is an internal server error, is passed to `onError`, and is never exposed in the response body. |

Router results and the standard `createHttpHandler()` mapping are:

| Router result | HTTP status |
| --- | --- |
| `resolved` | 200 after the registered handler returns JSON; a returned `Response` keeps its own status |
| `not_found` | 404 |
| `method_not_allowed` | 405 with `allow` |
| `invalid_input` | 400 |
| `invalid_parameter` | 400 |
| `internal_error` | 500 and optional `onError` notification |

HTTP deliberately does not provide path parameters, methods other than GET and
POST, header or cookie parameter bindings, CORS or authentication policy,
OpenAPI generation, or ownership of a listening server. The optional Node
bridge adapts one request at a time but does not call `listen()`. Consumers can
generate documentation from `router.routes` without a second route model.

## Output contracts

An output contract is optional. Add one when the same successful result schema
must drive HTTP response verification and MCP structured output:

```ts
import {
  createOutputContract,
  defineEntry,
  defineEntryEndpoint,
  verifyEntryOutput,
} from "@alpacakit/channels";
import {
  bindMcpEntry,
  createMcpOutputSchema,
} from "@alpacakit/channels/mcp";
import { z } from "zod";

const HintOutputSchema = z
  .object({
    hints: z.array(z.string()).readonly(),
  })
  .strict()
  .readonly();

const EntryWithOutput = defineEntry({
  name: "hint",
  parameters: [],
  project: () => null,
  output: createOutputContract(HintOutputSchema),
});

const EndpointWithOutput = defineEntryEndpoint(
  EntryWithOutput,
  bindMcpEntry(),
);

const outputSchema = createMcpOutputSchema(EndpointWithOutput);

const verified = verifyEntryOutput(EntryWithOutput, {
  hints: ["A validated result"],
});

void outputSchema;
void verified;
```

`createMcpOutputSchema()` requires an object output contract. Invalid output
passed to `verifyEntryOutput()` throws `EntryOutputContractError`.

## Error boundaries

- `EntryTreeDefinitionError` means the Tree or a channel Binding is invalid.
  Treat it as a startup or programmer error.
- `EntryInputError` may be thrown inside `project()` for an expected semantic
  input rejection. An entry target becomes `invalid_input`; pass
  `{ kind: ENTRY_INPUT_TARGET_KIND.parameter, parameterName: "name" }` to
  produce `invalid_parameter`. An unknown parameter name is an `internal_error`
  programmer failure.
- Codec and required-input failures become `invalid_parameter`.
- Any other projection exception becomes `internal_error` and retains the
  original error. It is never reported as caller input failure.
- `EntryOutputContractError` means a handler returned a value outside its
  declared success contract.

## Scope

The package provides the neutral entry tree, CLI router, optional CLI executor
and text renderers, MCP endpoint adapter, HTTP router and handler, and a
`node:http` bridge. It does not own process exit policy, automatic
`--help`/`--version` handling, MCP tool registration, authentication, or a
listening server lifecycle.

Every surface uses `defineEntryEndpoint()` with the applicable
`bindCliEntry()`, `bindMcpEntry()`, and `bindHttpEntry()` values. There is no
separate legacy option-descriptor API.

## Zod peer and source linking

Packed consumers are type-checked against the declared `zod: ^4.3.6` peer. A
packed channels build was verified with both Zod 4.3.6 and 4.4.3. Source-linking
the package is different: if channels resolves its development Zod 4.3.6 while
the consumer resolves 4.4.3, TypeScript can expand the two distinct Zod type
graphs until it reports excessive depth or exhausts memory. When linking source,
use exactly one shared Zod installation/version, or consume a packed tarball.
