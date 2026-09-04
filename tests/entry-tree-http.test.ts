import { describe, expect, expectTypeOf, it } from "vitest";
import { bindCliEntry, createCliRouter } from "../src/cli.js";
import {
  bindHttpEntry,
  createHttpRouter,
  HTTP_METHOD,
  HTTP_ROUTER_RESULT_KIND,
  isHttpResolvedEndpoint,
  overrideHttpSegment,
} from "../src/http.js";
import {
  codecs,
  defineEntry,
  defineEntryEndpoint,
  defineEntryNode,
  defineEntryTree,
  defineParameter,
  type EntryDefinition,
  EntryInputError,
  ENTRY_INPUT_TARGET_KIND,
  EntryTreeDefinitionError,
  optional,
  type ParameterSet,
  required,
} from "../src/index.js";

const HintEntry = defineEntry({
  name: "hint",
  parameters: [
    defineParameter({
      name: "query",
      codec: codecs.string(),
      requirement: required(),
      description: "Search query",
    }),
    defineParameter({
      name: "limit",
      codec: codecs.positiveInteger({ max: 100 }),
      requirement: optional({ default: 20 }),
      description: "Result limit",
    }),
    defineParameter({
      name: "tag",
      codec: codecs.stringList(),
      requirement: optional(),
      description: "Tags",
    }),
    defineParameter({
      name: "internalOnly",
      codec: codecs.string(),
      requirement: optional({ default: "server" }),
      description: "Internal value",
    }),
  ],
  project: ({ values }) => values,
});

const HintEndpoint = defineEntryEndpoint(
  HintEntry,
  bindHttpEntry({
    method: HTTP_METHOD.get,
    exclude: ["internalOnly"],
  }),
);

const SetEntry = defineEntry({
  name: "set",
  parameters: [
    defineParameter({
      name: "count",
      codec: codecs.positiveInteger(),
      requirement: optional({ default: 2 }),
      description: "Count",
    }),
  ],
  project: ({ values }) => values,
});

const SetEndpoint = defineEntryEndpoint(
  SetEntry,
  bindHttpEntry({ method: HTTP_METHOD.post }),
);

const RootEntry = defineEntry({
  name: "root",
  parameters: [],
  project: () => ({ root: true }),
});

const RootEndpoint = defineEntryEndpoint(RootEntry, bindHttpEntry());

function createTestTree() {
  return defineEntryTree(
    defineEntryNode({
      name: "app",
      description: "Application",
      endpoints: [RootEndpoint],
      children: [
        defineEntryNode({
          name: "hint",
          description: "Hints",
          endpoints: [HintEndpoint],
        }),
        defineEntryNode({
          name: "config",
          description: "Configuration",
          children: [
            defineEntryNode({
              name: "set",
              description: "Set configuration",
              endpoints: [SetEndpoint],
            }),
          ],
        }),
      ],
    }),
  );
}

function expectInvalidHttp(
  root: ReturnType<typeof defineEntryNode>,
  issue: string,
): void {
  try {
    createHttpRouter(defineEntryTree(root));
    throw new Error("Expected HTTP entry tree validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EntryTreeDefinitionError);
    if (error instanceof EntryTreeDefinitionError) {
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.stringContaining(issue)]),
      );
    }
  }
}

describe("HTTP tree compilation", () => {
  it("derives ordered routes and exposed parameter descriptions", () => {
    const router = createHttpRouter(createTestTree());

    expect(
      router.routes.map(({ method, path, segments, endpoint }) => ({
        method,
        path,
        segments,
        endpoint,
      })),
    ).toEqual([
      {
        method: HTTP_METHOD.get,
        path: "/hint",
        segments: ["hint"],
        endpoint: HintEndpoint,
      },
      {
        method: HTTP_METHOD.post,
        path: "/config/set",
        segments: ["config", "set"],
        endpoint: SetEndpoint,
      },
      {
        method: HTTP_METHOD.post,
        path: "/",
        segments: [],
        endpoint: RootEndpoint,
      },
    ]);
    expect(
      router.routes[0]?.parameters.map((parameter) => parameter.name),
    ).toEqual(["query", "limit", "tag"]);
    expect(router.routes[0]?.parameters[0]?.description).toBe("Search query");
    expect(router.endpoints).toEqual([HintEndpoint, SetEndpoint, RootEndpoint]);
  });

  it("keeps HTTP and CLI segment overrides independent", () => {
    const endpoint = defineEntryEndpoint(
      RootEntry,
      bindHttpEntry({ method: HTTP_METHOD.get }),
      bindCliEntry({ parameters: [] }),
    );
    const tree = defineEntryTree(
      defineEntryNode({
        name: "app",
        description: "Application",
        children: [
          defineEntryNode({
            name: "hint",
            description: "Hint",
            segments: [overrideHttpSegment({ segment: "hints" })],
            endpoints: [endpoint],
          }),
        ],
      }),
    );

    expect(createHttpRouter(tree).routes[0]?.path).toBe("/hints");
    expect(createCliRouter(tree).endpointLocations[0]?.path).toEqual(["hint"]);
  });

  it.each(["a b", "a/b"])("rejects invalid HTTP segment %j", (segment) => {
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        children: [
          defineEntryNode({
            name: "child",
            description: "Child",
            segments: [overrideHttpSegment({ segment })],
            endpoints: [RootEndpoint],
          }),
        ],
      }),
      `HTTP segment "${segment}" must be a URL-safe path segment`,
    );
  });

  it("rejects sibling collisions and multiple HTTP endpoints", () => {
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        children: ["one", "two"].map((name) =>
          defineEntryNode({
            name,
            description: name,
            segments: [overrideHttpSegment({ segment: "same" })],
            endpoints: [RootEndpoint],
          }),
        ),
      }),
      'HTTP sibling segment collision "same" between one and two',
    );
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        endpoints: [RootEndpoint, RootEndpoint],
      }),
      "more than one HTTP endpoint",
    );
  });

  it("rejects invalid exclusions and a tree without an HTTP endpoint", () => {
    const erasedEntry = HintEntry as unknown as EntryDefinition<
      string,
      ParameterSet,
      unknown
    >;
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        endpoints: [
          defineEntryEndpoint(
            erasedEntry,
            bindHttpEntry({ exclude: ["missing"] }),
          ),
        ],
      }),
      "HTTP binding excludes nonexistent parameter missing",
    );
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        endpoints: [
          defineEntryEndpoint(
            HintEntry,
            bindHttpEntry({ exclude: ["tag", "tag"] }),
          ),
        ],
      }),
      "duplicate HTTP exclusion for parameter tag",
    );
    expectInvalidHttp(
      defineEntryNode({
        name: "app",
        description: "Application",
        endpoints: [
          defineEntryEndpoint(HintEntry, bindHttpEntry({ exclude: ["query"] })),
        ],
      }),
      "required parameter query is unreachable from HTTP",
    );
    expectInvalidHttp(
      defineEntryNode({ name: "app", description: "Application" }),
      "entry tree has no HTTP endpoint",
    );
  });
});

describe("HTTP GET resolution", () => {
  const router = createHttpRouter(createTestTree());

  it("coerces scalar and repeated array strings and preserves defaults", async () => {
    const result = await router.resolve(
      new Request(
        "http://localhost/hint?query=entry%20tree&limit=5&tag=a&tag=b",
      ),
    );
    expect(result).toMatchObject({ kind: HTTP_ROUTER_RESULT_KIND.resolved });
    if (isHttpResolvedEndpoint(result, HintEndpoint)) {
      expectTypeOf(result.projection).toEqualTypeOf<
        ReturnType<typeof HintEntry.project>
      >();
      expect(result.projection).toEqual({
        query: "entry tree",
        limit: 5,
        tag: ["a", "b"],
        internalOnly: "server",
      });
      expect(result.request.headers).toBeInstanceOf(Headers);
    }

    const single = await router.resolve(
      new Request("http://localhost/hint?query=x&tag=a"),
    );
    if (isHttpResolvedEndpoint(single, HintEndpoint)) {
      expect(single.projection.tag).toEqual(["a"]);
      expect(single.projection.limit).toBe(20);
    }
  });

  it.each([
    ["?query=x&limit=abc", "limit", undefined],
    [
      "?query=x&limit=1&limit=2",
      "limit",
      "Parameter limit accepts a single value",
    ],
    ["?limit=1", "query", "Missing required parameter query"],
  ] as const)("reports invalid parameter input %#", async (query, name, issue) => {
    const result = await router.resolve(
      new Request(`http://localhost/hint${query}`),
    );
    expect(result).toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
      parameterName: name,
      ...(issue === undefined ? {} : { issues: [issue] }),
    });
  });

  it.each([
    "unknown",
    "internalOnly",
  ])("rejects unknown or excluded query key %s", async (name) => {
    const result = await router.resolve(
      new Request(`http://localhost/hint?query=x&${name}=value`),
    );
    expect(result).toEqual({
      kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
      path: "/hint",
      issues: [`Unknown parameter: ${name}`],
    });
  });

  it("uses exact paths and reports allowed methods", async () => {
    await expect(
      router.resolve(new Request("http://localhost/missing")),
    ).resolves.toEqual({
      kind: HTTP_ROUTER_RESULT_KIND.notFound,
      path: "/missing",
    });
    await expect(
      router.resolve(new Request("http://localhost/hint/")),
    ).resolves.toEqual({
      kind: HTTP_ROUTER_RESULT_KIND.notFound,
      path: "/hint/",
    });
    await expect(
      router.resolve(
        new Request("http://localhost/hint", { method: HTTP_METHOD.post }),
      ),
    ).resolves.toEqual({
      kind: HTTP_ROUTER_RESULT_KIND.methodNotAllowed,
      path: "/hint",
      allowed: [HTTP_METHOD.get],
    });
  });
});

describe("HTTP POST resolution", () => {
  const router = createHttpRouter(createTestTree());
  const post = (body?: string, contentType = "application/json") =>
    new Request("http://localhost/config/set", {
      method: HTTP_METHOD.post,
      headers: { "content-type": contentType },
      ...(body === undefined ? {} : { body }),
    });

  it("decodes JSON objects and accepts media type parameters", async () => {
    await expect(router.resolve(post('{"count":5}'))).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.resolved,
      projection: { count: 5 },
    });
    await expect(
      router.resolve(post('{"count":6}', "Application/JSON; charset=utf-8")),
    ).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.resolved,
      projection: { count: 6 },
    });
    await expect(router.resolve(post())).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.resolved,
      projection: { count: 2 },
    });
  });

  it.each([
    ["{}", "text/plain", "Expected an application/json request body"],
    ["{", "application/json", "Request body is not valid JSON"],
    ["[]", "application/json", "Request body must be a JSON object"],
    ['{"unknown":1}', "application/json", "Unknown parameter: unknown"],
  ])("rejects invalid POST body %#", async (body, contentType, issue) => {
    await expect(
      router.resolve(post(body, contentType)),
    ).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
      issues: [issue],
    });
  });

  it("enforces the incremental body limit", async () => {
    const smallRouter = createHttpRouter(createTestTree(), { maxBodyBytes: 8 });
    await expect(
      smallRouter.resolve(post('{"count":5}')),
    ).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
      issues: ["Request body exceeds 8 bytes"],
    });
  });

  it("does not coerce JSON strings", async () => {
    await expect(router.resolve(post('{"count":"5"}'))).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
      parameterName: "count",
    });
  });
});

describe("HTTP projection errors and endpoint types", () => {
  function errorRouter(project: () => unknown) {
    const entry = defineEntry({ name: "error", parameters: [], project });
    const endpoint = defineEntryEndpoint(
      entry,
      bindHttpEntry({ method: HTTP_METHOD.get }),
    );
    return createHttpRouter(
      defineEntryTree(
        defineEntryNode({
          name: "app",
          description: "Application",
          endpoints: [endpoint],
        }),
      ),
    );
  }

  it("maps projection EntryInputError targets", async () => {
    const entryResult = await errorRouter(() => {
      throw new EntryInputError(["invalid entry"]);
    }).resolve(new Request("http://localhost/"));
    expect(entryResult).toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
      issues: ["invalid entry"],
    });

    const parameterEntry = defineEntry({
      name: "parameter-error",
      parameters: [
        defineParameter({
          name: "query",
          codec: codecs.string(),
          requirement: required(),
          description: "Query",
        }),
      ],
      project: () => {
        throw new EntryInputError(["invalid query"], {
          kind: ENTRY_INPUT_TARGET_KIND.parameter,
          parameterName: "query",
        });
      },
    });
    const endpoint = defineEntryEndpoint(
      parameterEntry,
      bindHttpEntry({ method: HTTP_METHOD.get }),
    );
    const router = createHttpRouter(
      defineEntryTree(
        defineEntryNode({
          name: "app",
          description: "Application",
          endpoints: [endpoint],
        }),
      ),
    );
    await expect(
      router.resolve(new Request("http://localhost/?query=x")),
    ).resolves.toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
      parameterName: "query",
      issues: ["invalid query"],
    });
  });

  it("preserves unexpected projection errors", async () => {
    const error = new Error("projection failed");
    const result = await errorRouter(() => {
      throw error;
    }).resolve(new Request("http://localhost/"));
    expect(result).toMatchObject({
      kind: HTTP_ROUTER_RESULT_KIND.internalError,
    });
    if (result.kind === HTTP_ROUTER_RESULT_KIND.internalError) {
      expect(result.error).toBe(error);
    }
  });

  it("carries excluded names in the binding phantom type", () => {
    const invalidHttp = bindHttpEntry({ exclude: ["missing"] });
    // @ts-expect-error HTTP exclusions use the endpoint NoInfer constraint
    defineEntryEndpoint(HintEntry, invalidHttp);
  });
});
