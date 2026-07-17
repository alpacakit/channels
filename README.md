# @alpacakit/channels

Define an entry once, bind it to CLI and MCP, and use the same typed endpoint
for argument parsing, help, MCP schemas, input decoding, and projection.

HTTP routing is not currently provided. The supported entry-tree channels are
CLI and MCP.

## The mental model

You only need four concepts:

```text
Entry    = what the command accepts and what it projects
Binding  = how one channel supplies that input
Endpoint = the Entry and its Bindings bundled together
Tree     = where the Endpoint lives in the command hierarchy
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

There is no CLI or MCP logic here. The Entry describes the operation itself.

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

An MCP Binding selects the Entry parameters exposed as tool input:

```ts
import { bindMcpEntry } from "@alpacakit/channels/mcp";

const HintMcpBinding = bindMcpEntry("query", "limit");
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

## 3. Bundle the Entry and Bindings: Endpoint

An Endpoint is the public execution identity for the operation:

```ts
import { defineEntryEndpoint } from "@alpacakit/channels";

const HintEndpoint = defineEntryEndpoint(
  HintEntry,
  HintCliBinding,
  HintMcpBinding,
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
└── MCP input mapping
    ├── expose query
    └── expose limit
```

Keep the object returned by `defineEntryEndpoint()`. CLI result narrowing and
all MCP runtime APIs use endpoint identity. Do not reconstruct an equivalent
Endpoint later.

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

CLI and MCP have different inputs, but they converge on the same decoder,
defaults, and projection:

```text
CLI argv ──> CLI Binding ──┐
                           │
                           ▼
                     HintEndpoint
                           │
                           ▼
                     Shared Decoder
                           │
                           ▼
                   HintEntry.project()
                           │
                           ▼
                    same projection
                           ▲
                           │
MCP JSON ──> MCP Binding ──┘
```

If `limit` is omitted from either channel, both produce the Entry default:

```ts
{
  query: "entry tree",
  limit: 20,
}
```

## Where each decision belongs

When adding a command, ask these questions in order:

| Question | Definition |
| --- | --- |
| What values does the operation need? | Entry parameters |
| How are they validated and defaulted? | Entry codecs and requirements |
| What application value should be produced? | Entry `project()` |
| How does CLI supply each value? | CLI Binding |
| Which values does MCP expose? | MCP Binding |
| What object ties the operation and channels together? | Endpoint |
| Under which command path does it live? | Tree |

Do not put CLI flags, MCP property selection, or command-tree placement on the
Entry. Do not repeat codecs, requiredness, or defaults in Bindings.

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
│       CLI and MCP Bindings
│
├── command-tree.ts
│   └── CommandTree
│       command hierarchy
│
├── cli.ts
│   └── createCliRouter(CommandTree)
│
└── mcp.ts
    └── createMcpEndpoint(HintEndpoint)
```

## Package entries

The neutral model and channel adapters are intentionally separate imports:

| Import | Purpose |
| --- | --- |
| `@alpacakit/channels` | Parameters, codecs, entries, output contracts, and entry-tree builders |
| `@alpacakit/channels/cli` | CLI bindings/coercion, router, typed executor, help traversal, and text renderers |
| `@alpacakit/channels/mcp` | MCP binding, the compiled endpoint handle, output schema projection, and the resolved-result guard |

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
  segments: [overrideCliSegment({ token: "h", aliases: ["hi"] })],
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

The router's `help` property contains the compiled hierarchy, aliases,
render-ready option groups, positionals, requiredness, defaults, repeat modes,
and generated negative flags. Authored option-section names are resolved during
projection, so renderers consume `optionGroups` without performing a join.
`findCliHelpSurface()`, `listCliHelpSurfaces()`, `renderCliHelp()`, and
`formatCliRouterError()` provide standard lookup, traversal, one-surface text
rendering, and diagnostics without writing output or choosing an exit code.
`renderCliHelp()` implements `CliHelpRender`; its context carries the full
selected `programName`, root `executableName`, path, and description preference.
The renderer path uses canonical CLI segment tokens; a directly invoked alias
may still be preserved in `programName` for user-facing usage text.
`--help`, complete-reference framing, and `--version` remain application policy.

The router returns a discriminated union:

- `resolved`
- `unknown_command`
- `incomplete_command`
- `invalid_input`
- `internal_error`

`path` is preserved for diagnostics. Consumers may use the standard formatter
or supply their own wording. Process exit codes remain consumer policy.

## MCP reference

`createMcpEndpoint()` compiles the Endpoint once and returns the handle used for
both schema generation and runtime parsing. Do not keep a second runtime copy of
the MCP Binding.

```ts
declare const toolArguments: Record<string, unknown>;

const mcpEndpoint = createMcpEndpoint(HintEndpoint);
const inputShape = mcpEndpoint.inputSchema;
const result = mcpEndpoint.parse(toolArguments);
```

`inputSchema` is a raw Zod object shape. It includes only MCP-bound parameters
and projects their schemas, descriptions, and requiredness.

`parse()` applies Entry defaults to all parameters, validates bound input, and
runs the Entry projection. It returns:

- `resolved` with the typed projection
- `invalid_input` for missing input, codec failures, or an `EntryInputError`
  deliberately thrown by `project()`
- `internal_error` with the original error for an unexpected `project()` throw

`isMcpResolved(result)` narrows a parse result to its `resolved` variant, the
MCP counterpart of `isCliResolvedEndpoint()`.

An invalid Endpoint binding throws `EntryTreeDefinitionError` from
`createMcpEndpoint()` itself, so definition errors surface at construction rather
than on the first invocation.

MCP tool naming and registration stay with the consumer. Hierarchical MCP tool
names are not currently derived from the Tree.

## Output contracts

An output contract is optional. Add one when the same successful result schema
must drive runtime verification and MCP structured output:

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
  input rejection. It becomes `invalid_input`. Pass
  `{ parameterName: "name" }` to associate all issues with one Entry parameter;
  an unknown parameter name is an `internal_error` programmer failure.
- Codec and required-input failures become `invalid_input`.
- Any other projection exception becomes `internal_error` and retains the
  original error. It is never reported as caller input failure.
- `EntryOutputContractError` means a handler returned a value outside its
  declared success contract.

## Scope

The package currently provides the neutral entry tree, CLI router, optional CLI
executor and text renderers, and MCP endpoint adapter. It does not provide an
HTTP router, process exit policy, automatic `--help`/`--version` handling, MCP
tool registration, authentication, or a network listener.

Every command surface uses `defineEntryEndpoint()` with `bindCliEntry()` and
`bindMcpEntry()`. There is no separate legacy option-descriptor API.

## Zod peer and source linking

Packed consumers are type-checked against the declared `zod: ^4.3.6` peer. A
packed channels build was verified with both Zod 4.3.6 and 4.4.3. Source-linking
the package is different: if channels resolves its development Zod 4.3.6 while
the consumer resolves 4.4.3, TypeScript can expand the two distinct Zod type
graphs until it reports excessive depth or exhausts memory. When linking source,
use exactly one shared Zod installation/version, or consume a packed tarball.
