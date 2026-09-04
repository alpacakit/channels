import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  bindHttpEntry,
  createHttpHandler,
  createHttpRouter,
  handleHttpEndpoint,
  HTTP_METHOD,
  HTTP_ROUTER_RESULT_KIND,
  HttpHandlerDefinitionError,
} from "../src/http.js";
import {
  codecs,
  createOutputContract,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryTreeEndpoint,
  EntryInputError,
  ENTRY_INPUT_TARGET_KIND,
  EntryOutputContractError,
  required,
} from "../src/index.js";

const InputEntry = defineEntry({
  name: "input",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Query",
    }),
  ],
  project: ({ values }) => {
    if (values.query === "projection-error") {
      throw new Error("private projection failure");
    }
    return { query: values.query };
  },
});

const InputEndpoint = defineEntryEndpoint(
  InputEntry,
  bindHttpEntry({ method: HTTP_METHOD.get }),
);

function routerFor(
  endpoint: EntryTreeEndpoint = InputEndpoint,
  path = "input",
): ReturnType<typeof createHttpRouter> {
  return createHttpRouter(
    defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "Application",
        children: [
          defineEntryNode({
            name: path,
            description: "Input",
            endpoints: [endpoint],
          }),
        ],
      }),
    ),
  );
}

async function expectJsonResponse(
  response: Response,
  status: number,
  body: unknown,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  await expect(response.json()).resolves.toEqual(body);
}

describe("HTTP handler registry", () => {
  it("rejects missing, duplicate, and out-of-router handlers eagerly", () => {
    const router = routerFor();
    const binding = handleHttpEndpoint(
      InputEndpoint,
      ({ projection }) => projection,
    );
    expect(() => createHttpHandler(router, [])).toThrowError(
      "missing handler for endpoint input",
    );
    expect(() => createHttpHandler(router, [binding, binding])).toThrowError(
      "duplicate handler for endpoint input",
    );

    const outsideEntry = defineEntry({
      name: "outside",
      parameters: [],
      project: () => null,
    });
    const outsideEndpoint = defineEntryEndpoint(outsideEntry, bindHttpEntry());
    try {
      createHttpHandler(router, [
        binding,
        handleHttpEndpoint(outsideEndpoint, () => null),
      ]);
      throw new Error("Expected handler registry validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpHandlerDefinitionError);
      if (error instanceof HttpHandlerDefinitionError) {
        expect(error.issues).toContain(
          "handler endpoint outside is not in the router",
        );
      }
    }
  });
});

describe("HTTP handler response mapping", () => {
  it("maps every router result and reports internal errors", async () => {
    const router = routerFor();
    const onError = vi.fn();
    const handle = createHttpHandler(
      router,
      [handleHttpEndpoint(InputEndpoint, ({ projection }) => projection)],
      { onError },
    );

    await expectJsonResponse(
      await handle(new Request("http://localhost/input?query=ok")),
      200,
      { query: "ok" },
    );
    await expectJsonResponse(
      await handle(new Request("http://localhost/missing")),
      404,
      { error: { kind: HTTP_ROUTER_RESULT_KIND.notFound } },
    );
    const methodResponse = await handle(
      new Request("http://localhost/input", { method: HTTP_METHOD.post }),
    );
    expect(methodResponse.headers.get("allow")).toBe(HTTP_METHOD.get);
    await expectJsonResponse(methodResponse, 405, {
      error: {
        kind: HTTP_ROUTER_RESULT_KIND.methodNotAllowed,
        allowed: [HTTP_METHOD.get],
      },
    });
    await expectJsonResponse(
      await handle(new Request("http://localhost/input?unknown=x")),
      400,
      {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
          issues: ["Unknown parameter: unknown"],
        },
      },
    );
    await expectJsonResponse(
      await handle(new Request("http://localhost/input")),
      400,
      {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
          parameterName: "query",
          issues: ["Missing required parameter query"],
        },
      },
    );
    const internalRequest = new Request(
      "http://localhost/input?query=projection-error",
      { headers: { "x-request-id": "one" } },
    );
    const internalResponse = await handle(internalRequest);
    await expectJsonResponse(internalResponse, 500, {
      error: { kind: HTTP_ROUTER_RESULT_KIND.internalError },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toBe(internalRequest);
  });

  it("passes a handler Response through untouched", async () => {
    const custom = new Response("custom", {
      status: 404,
      headers: { "x-custom": "yes" },
    });
    const handle = createHttpHandler(routerFor(), [
      handleHttpEndpoint(InputEndpoint, () => custom),
    ]);

    const response = await handle(
      new Request("http://localhost/input?query=ok"),
    );
    expect(response).toBe(custom);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("custom");
  });
});

describe("HTTP handler output contracts", () => {
  const OutputEntry = defineEntry({
    name: "output",
    parameters: [],
    project: () => null,
    output: createOutputContract(
      z.object({ ok: z.boolean() }).strict().readonly(),
    ),
  });
  const OutputEndpoint = defineEntryEndpoint(OutputEntry, bindHttpEntry());
  const router = routerFor(OutputEndpoint, "output");

  it("returns conforming output as JSON", async () => {
    const handle = createHttpHandler(router, [
      handleHttpEndpoint(OutputEndpoint, () => ({ ok: true })),
    ]);

    await expectJsonResponse(
      await handle(
        new Request("http://localhost/output", {
          method: HTTP_METHOD.post,
          headers: { "content-type": "application/json" },
        }),
      ),
      200,
      { ok: true },
    );
  });

  it("maps output violations to an opaque 500", async () => {
    const onError = vi.fn();
    const handle = createHttpHandler(
      router,
      [handleHttpEndpoint(OutputEndpoint, () => ({ ok: "not boolean" }))],
      { onError },
    );
    const response = await handle(
      new Request("http://localhost/output", {
        method: HTTP_METHOD.post,
        headers: { "content-type": "application/json" },
      }),
    );

    await expectJsonResponse(response, 500, {
      error: { kind: HTTP_ROUTER_RESULT_KIND.internalError },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(EntryOutputContractError);
  });
});

describe("HTTP handler exceptions", () => {
  it("maps EntryInputError from handlers to 400", async () => {
    const entryError = new EntryInputError(["not allowed"]);
    const entryHandle = createHttpHandler(routerFor(), [
      handleHttpEndpoint(InputEndpoint, () => {
        throw entryError;
      }),
    ]);
    await expectJsonResponse(
      await entryHandle(new Request("http://localhost/input?query=ok")),
      400,
      {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
          issues: ["not allowed"],
        },
      },
    );

    const parameterHandle = createHttpHandler(routerFor(), [
      handleHttpEndpoint(InputEndpoint, () => {
        throw new EntryInputError(["bad query"], {
          kind: ENTRY_INPUT_TARGET_KIND.parameter,
          parameterName: "query",
        });
      }),
    ]);
    await expectJsonResponse(
      await parameterHandle(new Request("http://localhost/input?query=ok")),
      400,
      {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
          parameterName: "query",
          issues: ["bad query"],
        },
      },
    );
  });

  it("maps unexpected and unknown-target errors to opaque 500 responses", async () => {
    const errors = [
      new Error("secret handler failure"),
      new EntryInputError(["secret target failure"], {
        kind: ENTRY_INPUT_TARGET_KIND.parameter,
        parameterName: "missing",
      }),
    ];
    for (const error of errors) {
      const onError = vi.fn();
      const handle = createHttpHandler(
        routerFor(),
        [
          handleHttpEndpoint(InputEndpoint, () => {
            throw error;
          }),
        ],
        { onError },
      );
      const response = await handle(
        new Request("http://localhost/input?query=ok"),
      );
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toBe(
        JSON.stringify({
          error: { kind: HTTP_ROUTER_RESULT_KIND.internalError },
        }),
      );
      expect(body).not.toContain(error.message);
      expect(onError).toHaveBeenCalledWith(error, expect.any(Request));
    }
  });
});
