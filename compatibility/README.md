# Zod consumer compatibility fixture

Copy `zod-consumer.ts` into an isolated TypeScript project that installs a
packed `@alpacaloop/channels` build, then type-check it with `skipLibCheck:
false`.

The supported matrix currently covers Zod 4.3.6 and 4.4.3. Both versions must
type-check when the package is installed from its packed output.

Do not use a source link for this compatibility check. A source link can cause
channels to resolve its development Zod while the consumer resolves another
Zod installation. That deliberately tests duplicate dependency resolution, not
the published peer contract, and can produce `TS2589` or exhaust TypeScript's
memory. Source-linked development must share the consumer's exact Zod
installation.
