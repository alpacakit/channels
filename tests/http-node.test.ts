import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindHttpEntry,
  createHttpHandler,
  createHttpRouter,
  handleHttpEndpoint,
  HTTP_METHOD,
} from "../src/http.js";
import { createNodeRequestListener } from "../src/http-node.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  required,
} from "../src/index.js";

const GetEntry = defineEntry({
  name: "get",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Query",
    }),
  ],
  project: ({ values }) => values,
});

const PostEntry = defineEntry({
  name: "post",
  parameters: [
    defineParameter({
      name: "value",
      codec: codecs.string(),
      requirement: required(),
      description: "Value",
    }),
  ],
  project: ({ values }) => values,
});

const GetEndpoint = defineEntryEndpoint(
  GetEntry,
  bindHttpEntry({ method: HTTP_METHOD.get }),
);
const PostEndpoint = defineEntryEndpoint(PostEntry, bindHttpEntry());

const router = createHttpRouter(
  defineEntryTree(
    defineEntryNode({
      name: "app",
      description: "Application",
      children: [
        defineEntryNode({
          name: "get",
          description: "Get",
          endpoints: [GetEndpoint],
        }),
        defineEntryNode({
          name: "post",
          description: "Post",
          endpoints: [PostEndpoint],
        }),
      ],
    }),
  ),
);

const handle = createHttpHandler(router, [
  handleHttpEndpoint(GetEndpoint, ({ projection }) => projection),
  handleHttpEndpoint(PostEndpoint, ({ projection }) => projection),
]);
const server = createServer(createNodeRequestListener(handle));
let origin = "";

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server did not bind a TCP port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

describe("Node HTTP bridge", () => {
  it("serves GET and POST requests through Fetch request handling", async () => {
    const getResponse = await fetch(`${origin}/get?query=hello`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({ query: "hello" });

    const postResponse = await fetch(`${origin}/post`, {
      method: HTTP_METHOD.post,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "saved" }),
    });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({ value: "saved" });
  });

  it("serves method and path errors", async () => {
    const methodResponse = await fetch(`${origin}/get`, {
      method: HTTP_METHOD.post,
    });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toBe(HTTP_METHOD.get);
    await expect(methodResponse.json()).resolves.toEqual({
      error: { kind: "method_not_allowed", allowed: [HTTP_METHOD.get] },
    });

    const missingResponse = await fetch(`${origin}/missing`);
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      error: { kind: "not_found" },
    });
  });
});
