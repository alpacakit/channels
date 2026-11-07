import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const compatibilityDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(compatibilityDir, "../../..");
const workRoot = mkdtempSync(join(tmpdir(), "channels-packed-consumers-"));
const packDir = join(workRoot, "packs");
mkdirSync(packDir);
const channelsVersion = JSON.parse(
  readFileSync(join(repositoryRoot, "packages/channels/package.json")),
).version;

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function capture(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: process.env,
    encoding: "utf8",
  }).trim();
}

function copyFixture(source, target) {
  cpSync(join(compatibilityDir, source), join(target, basename(source)));
}

function offlineZodPackage(version) {
  const workspaceCopy = join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    `zod@${version}`,
    "node_modules",
    "zod",
  );
  if (existsSync(workspaceCopy)) return workspaceCopy;
  const store = capture("pnpm", ["store", "path"]);
  const links = join(store, "links", "@", "zod", version);
  for (const hash of existsSync(links) ? readdirSync(links) : []) {
    const candidate = join(links, hash, "node_modules", "zod");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Zod ${version} is not available offline; rerun with CHANNELS_CONSUMER_INSTALL_MODE=online`,
  );
}

run("pnpm", ["--filter", "@alpacakit/channels", "build"]);
run("pnpm", [
  "--dir",
  "packages/channels",
  "pack",
  "--pack-destination",
  packDir,
]);

const channelsTarball = join(
  packDir,
  `alpacakit-channels-${channelsVersion}.tgz`,
);
const packedManifest = JSON.parse(
  capture("tar", ["-xOzf", channelsTarball, "package/package.json"]),
);
const expectedExportKeys = [".", "./cli", "./http", "./mcp"];
function assertExactExportKeys(exportKeys) {
  const actual = [...exportKeys].sort();
  const expected = [...expectedExportKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `Unexpected package exports: ${JSON.stringify(exportKeys)}`,
    );
  }
}
const exportKeys = Object.keys(packedManifest.exports);
assertExactExportKeys(exportKeys);
assertExactExportKeys([...exportKeys].reverse());
let extraExportRejected = false;
try {
  assertExactExportKeys([...exportKeys, "./http/node"]);
} catch {
  extraExportRejected = true;
}
if (!extraExportRejected) {
  throw new Error("Removed ./http/node export was accepted by the set check");
}
let missingExportAccepted = true;
try {
  assertExactExportKeys(exportKeys.slice(1));
} catch {
  missingExportAccepted = false;
}
if (missingExportAccepted) {
  throw new Error("Missing package export was accepted by the set check");
}
if (packedManifest.exports["./http/node"] !== undefined) {
  throw new Error("Removed ./http/node export is still packed");
}
const forbiddenDependencies = [
  "@modelcontextprotocol/sdk",
  "hono",
  "express",
  "commander",
];
for (const manifest of [packedManifest]) {
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of forbiddenDependencies) {
      if (manifest[field]?.[name] !== undefined) {
        throw new Error(`${name} leaked into ${manifest.name} ${field}`);
      }
    }
  }
}
const packedFiles = capture("tar", ["-tzf", channelsTarball]).split("\n");
for (const removed of [
  "package/dist/http-node.js",
  "package/dist/http-node.d.ts",
  "package/dist/cli-application.js",
  "package/dist/cli-executor.js",
  "package/dist/cli-result-envelope.js",
  "package/dist/http-handler.js",
  "package/dist/endpoint-handlers.js",
]) {
  if (packedFiles.includes(removed))
    throw new Error(`Removed artifact is packed: ${removed}`);
}
console.log(
  "PASS pack export set/order/add/remove controls, dependencies, and removed artifacts",
);

const externalDir = join(workRoot, "external-sdk");
mkdirSync(externalDir);
copyFixture("external-consumer.package.json", externalDir);
copyFixture("tsconfig.external-consumer.json", externalDir);
copyFixture("external-consumer.ts", externalDir);
copyFixture("external-consumer-types.ts", externalDir);
copyFixture("removed-api-negative.ts", externalDir);
writeFileSync(
  join(externalDir, "package.json"),
  readFileSync(join(externalDir, "external-consumer.package.json")),
);
const installMode = process.env.CHANNELS_CONSUMER_INSTALL_MODE ?? "offline";
const npmInstall = [
  "install",
  "--package-lock=false",
  ...(installMode === "offline" ? ["--offline"] : []),
];
run("npm", [...npmInstall, channelsTarball], { cwd: externalDir });
cpSync(
  join(externalDir, "node_modules/@alpacakit/channels/examples/book-search.ts"),
  join(externalDir, "packed-book-search.ts"),
);
cpSync(
  join(externalDir, "node_modules/@alpacakit/channels/examples/greeting.ts"),
  join(externalDir, "packed-greeting.ts"),
);
run("npx", ["tsc", "-p", "tsconfig.external-consumer.json"], {
  cwd: externalDir,
});
run("node", ["dist/external-consumer.js"], { cwd: externalDir });
run(
  "node",
  [
    "--input-type=module",
    "--eval",
    "const api = await import('@alpacakit/channels'); const cli = await import('@alpacakit/channels/cli'); const http = await import('@alpacakit/channels/http'); const mcp = await import('@alpacakit/channels/mcp'); if (api.handleCliEndpoint || cli.handleCliEndpoint || http.handleHttpEndpoint || mcp.createMcpEndpoint) process.exit(1); await import('@alpacakit/channels/http/node').then(() => process.exit(1), () => {});",
  ],
  { cwd: externalDir },
);
console.log("PASS removed API runtime negative controls");

for (const version of ["4.3.6", "4.4.3"]) {
  const matrixDir = join(workRoot, `zod-${version}`);
  mkdirSync(matrixDir);
  copyFixture("zod-consumer.package.json", matrixDir);
  copyFixture("tsconfig.zod-consumer.json", matrixDir);
  copyFixture("zod-consumer.ts", matrixDir);
  writeFileSync(
    join(matrixDir, "package.json"),
    readFileSync(join(matrixDir, "zod-consumer.package.json")),
  );
  let zodInstall = `zod@${version}`;
  if (installMode === "offline") {
    const zodPackDir = join(packDir, `zod-${version}`);
    mkdirSync(zodPackDir);
    run("pnpm", [
      "--dir",
      offlineZodPackage(version),
      "pack",
      "--pack-destination",
      zodPackDir,
    ]);
    zodInstall = join(zodPackDir, `zod-${version}.tgz`);
  }
  run("npm", [...npmInstall, zodInstall, channelsTarball], {
    cwd: matrixDir,
  });
  run("npx", ["tsc", "-p", "tsconfig.zod-consumer.json"], { cwd: matrixDir });
  console.log(`PASS Zod ${version} packed consumer`);
}

console.log(`PASS all packed consumers (${workRoot})`);
