// Package-boundary guard (restored from the monorepo extraction). Each library
// under packages/* is published and installed on its own, so its source must
// never reach a sibling package through a relative path that escapes the
// package directory — cross-package access has to go through the sibling's
// published name (e.g. "@alpacakit/core"). A relative import that resolves
// outside this package would build in the workspace yet break once published.
//
// The public-surface guard keeps the CLI and MCP bindings behind their own
// subpath exports ("./cli", "./mcp"). The always-loaded root barrel must not
// re-export them, so a consumer that only wants the neutral channel model never
// pulls the CLI/MCP compilers into its module graph.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const ROOT_BARREL = path.join(SOURCE_ROOT, "index.ts");
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/gu;
const CLI_OR_MCP_MODULE_PATTERN = /^\.\/(?:cli|mcp)/;

describe("package boundary", () => {
  it("keeps every relative import inside the package", async () => {
    const escapes: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (specifier === undefined || !specifier.startsWith(".")) {
          continue;
        }
        const resolved = path.resolve(path.dirname(file), specifier);
        if (
          resolved !== PACKAGE_ROOT &&
          !resolved.startsWith(`${PACKAGE_ROOT}${path.sep}`)
        ) {
          escapes.push(`${path.relative(PACKAGE_ROOT, file)} -> ${specifier}`);
        }
      }
    }

    expect(escapes).toEqual([]);
  });
});

describe("channels public surface", () => {
  it("keeps the CLI and MCP bindings out of the root barrel", async () => {
    const barrel = await readFile(ROOT_BARREL, "utf8");
    const specifiers = [...barrel.matchAll(IMPORT_SPECIFIER_PATTERN)]
      .map((match) => match[1] ?? match[2])
      .filter((specifier): specifier is string => specifier !== undefined);

    // Anti-vacuity: the barrel must actually re-export the neutral surface.
    expect(specifiers.length).toBeGreaterThan(0);
    expect(
      specifiers.filter((specifier) =>
        CLI_OR_MCP_MODULE_PATTERN.test(specifier),
      ),
    ).toEqual([]);
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return await sourceFiles(file);
      }
      return file.endsWith(".ts") ? [file] : [];
    }),
  );
  return nested.flat();
}
