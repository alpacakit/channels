# Packed consumer compatibility

Run this from the repository root:

```sh
node packages/channels/compatibility/verify-packed-consumers.mjs
```

The script builds channels, creates the package with `pnpm pack`,
and installs the tarball into fresh OS temporary directories. It then checks:

- the strict public declarations and the removed-API negative controls;
- Hono 4.13.7, MCP SDK 1.30.0, and Commander 14.0.3 runtime registration;
- the exact shipped `examples/greeting.ts` source through Hono `app.request`,
  MCP in-memory `listTools`/`callTool`, and Commander `parseAsync`;
- package exports as an order-independent exact set, removed distribution
  artifacts, and SDK dependency absence;
- the Zod peer minimum 4.3.6 and matrix version 4.4.3 in separate consumers.

Every consumer uses normal npm peer dependency resolution. The verification
does not use `--legacy-peer-deps` or another peer-contract bypass.

The default `CHANNELS_CONSUMER_INSTALL_MODE=offline` uses already cached exact
SDK packages and packs cached Zod copies. It performs no network access. On a
machine without those cached versions, explicitly allow version resolution:

```sh
CHANNELS_CONSUMER_INSTALL_MODE=online \
  node packages/channels/compatibility/verify-packed-consumers.mjs
```

Only that opt-in mode can access the npm registry. Installation always occurs
inside the generated temporary consumers; the workspace lockfile and root
installation are not changed.

`zod-consumer.ts` is intentionally checked once per isolated Zod version. Do
not source-link channels or combine different Zod installations in one
consumer: that tests duplicate dependency resolution instead of the published
peer contract and can produce `TS2589` or exhaust TypeScript's memory.
