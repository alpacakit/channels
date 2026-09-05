// Each packages/* library is published independently. Relative imports must
// stay inside this package, and channel-specific modules must remain behind
// their subpath exports rather than entering the neutral root barrel.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const ROOT_BARREL = path.join(SOURCE_ROOT, "index.ts");
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/gu;
const CHANNEL_MODULE_PATTERN = /^\.\/(?:cli|mcp|http)/;

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
  it("keeps channel bindings out of the neutral root barrel", async () => {
    const barrel = await readFile(ROOT_BARREL, "utf8");
    const specifiers = [...barrel.matchAll(IMPORT_SPECIFIER_PATTERN)]
      .map((match) => match[1] ?? match[2])
      .filter((specifier): specifier is string => specifier !== undefined);

    expect(specifiers.length).toBeGreaterThan(0);
    expect(
      specifiers.filter((specifier) => CHANNEL_MODULE_PATTERN.test(specifier)),
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
