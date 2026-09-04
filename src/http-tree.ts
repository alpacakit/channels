import {
  compileHttpBinding,
  type CompiledHttpEndpoint,
  isHttpEntryBinding,
  isHttpSegment,
} from "./http-compiler.js";
import {
  HTTP_METHOD,
  HTTP_ROUTER_RESULT_KIND,
  type HttpRoute,
  type HttpRouter,
  type HttpRouterResult,
} from "./http-model.js";
import type {
  EntryTreeDefinition,
  EntryTreeNode,
  RawValueMap,
} from "./model.js";
import { decodeEntryInput, type EntryDecodeResult } from "./runtime.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  formatTreePath,
  validateEntryTreeStructure,
} from "./schema.js";
import { coerceStringValue } from "./string-coercion.js";
import {
  CHANNEL,
  ENTRY_DECODE_RESULT_KIND,
  VALUE_SHAPE_KIND,
} from "./values.js";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const HTTP_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

const HTTP_RAW_RESULT_KIND = {
  raw: "raw",
  invalidInput: "invalid_input",
  invalidParameter: "invalid_parameter",
} as const;

const HTTP_BODY_RESULT_KIND = {
  body: "body",
  tooLarge: "too_large",
} as const;

type CompiledHttpRoute = {
  readonly route: HttpRoute;
  readonly compiledEndpoint: CompiledHttpEndpoint;
};

type HttpNodeFrame = {
  readonly node: EntryTreeNode;
  readonly logicalPath: readonly string[];
  readonly segments: readonly string[];
  readonly root: boolean;
};

type HttpRawResult =
  | {
      readonly kind: typeof HTTP_RAW_RESULT_KIND.raw;
      readonly raw: RawValueMap;
    }
  | {
      readonly kind: typeof HTTP_RAW_RESULT_KIND.invalidInput;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof HTTP_RAW_RESULT_KIND.invalidParameter;
      readonly parameterName: string;
      readonly issues: readonly string[];
    };

type HttpBodyResult =
  | {
      readonly kind: typeof HTTP_BODY_RESULT_KIND.body;
      readonly text: string;
    }
  | { readonly kind: typeof HTTP_BODY_RESULT_KIND.tooLarge };

export function createHttpRouter(
  tree: EntryTreeDefinition,
  options?: { readonly maxBodyBytes?: number },
): HttpRouter {
  const routes = compileHttpTree(tree);
  const maxBodyBytes = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const routesByPath = indexRoutesByPath(routes);
  return {
    routes: routes.map((compiled) => compiled.route),
    endpoints: routes.map((compiled) => compiled.route.endpoint),
    resolve: async (request) =>
      await resolveHttp(routesByPath, request, maxBodyBytes),
  };
}

function compileHttpTree(
  tree: EntryTreeDefinition,
): readonly CompiledHttpRoute[] {
  const issues = [...validateEntryTreeStructure(tree)];
  validateRootHttpSegment(tree.root, issues);
  const routes: CompiledHttpRoute[] = [];
  let rootRoute: CompiledHttpRoute | null = null;
  const pending: HttpNodeFrame[] = [
    {
      node: tree.root,
      logicalPath: [tree.root.name],
      segments: [],
      root: true,
    },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const compiledEndpoint = httpEndpointFor(current, issues);
    if (compiledEndpoint !== null) {
      const route = createCompiledRoute(current.segments, compiledEndpoint);
      if (current.root) {
        rootRoute = route;
      } else {
        routes.push(route);
      }
    }
    const children = httpChildFrames(current, issues);
    pending.push(...children.reverse());
  }
  if (rootRoute !== null) {
    routes.push(rootRoute);
  }
  if (routes.length === 0) {
    issues.push("entry tree has no HTTP endpoint");
  }
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  return routes;
}

function validateRootHttpSegment(root: EntryTreeNode, issues: string[]): void {
  const override = root.segments.find((row) => row.channel === CHANNEL.http);
  if (override !== undefined && !isHttpSegment(override.segment)) {
    issues.push(
      `${formatTreePath([root.name])}: invalid HTTP segment override`,
    );
  }
}

function httpChildFrames(
  parent: HttpNodeFrame,
  issues: string[],
): HttpNodeFrame[] {
  const frames: HttpNodeFrame[] = [];
  const owners = new Map<string, string>();
  for (const child of parent.node.children) {
    const logicalPath = [...parent.logicalPath, child.name];
    const segment = httpSegmentFor(child, logicalPath, issues);
    const owner = owners.get(segment);
    if (owner !== undefined) {
      issues.push(
        `${formatTreePath(parent.logicalPath)}: HTTP sibling segment collision ${JSON.stringify(segment)} between ${owner} and ${child.name}`,
      );
    } else {
      owners.set(segment, child.name);
    }
    frames.push({
      node: child,
      logicalPath,
      segments: [...parent.segments, segment],
      root: false,
    });
  }
  return frames;
}

function httpSegmentFor(
  node: EntryTreeNode,
  logicalPath: readonly string[],
  issues: string[],
): string {
  const override = node.segments.find((row) => row.channel === CHANNEL.http);
  let segment = node.name;
  if (override !== undefined) {
    if (isHttpSegment(override.segment)) {
      segment = override.segment.segment;
    } else {
      issues.push(
        `${formatTreePath(logicalPath)}: invalid HTTP segment override`,
      );
    }
  }
  if (!HTTP_SEGMENT_PATTERN.test(segment)) {
    issues.push(
      `${formatTreePath(logicalPath)}: HTTP segment ${JSON.stringify(segment)} must be a URL-safe path segment`,
    );
  }
  return segment;
}

function httpEndpointFor(
  frame: HttpNodeFrame,
  issues: string[],
): CompiledHttpEndpoint | null {
  const endpoints = frame.node.endpoints.filter((endpoint) =>
    endpoint.channels.some((binding) => binding.channel === CHANNEL.http),
  );
  const location = formatTreePath(frame.logicalPath);
  if (endpoints.length > 1) {
    issues.push(`${location}: more than one HTTP endpoint`);
  }
  const endpoint = endpoints[0];
  if (endpoint === undefined) {
    return null;
  }
  const channelBinding = findChannelBinding(endpoint, CHANNEL.http);
  if (channelBinding === null || !isHttpEntryBinding(channelBinding.binding)) {
    issues.push(`${location}: invalid HTTP endpoint binding`);
    return null;
  }
  return compileHttpBinding(
    endpoint,
    channelBinding.binding,
    `${location}#${endpoint.entry.name}`,
    issues,
  );
}

function createCompiledRoute(
  segments: readonly string[],
  compiledEndpoint: CompiledHttpEndpoint,
): CompiledHttpRoute {
  return {
    route: {
      method: compiledEndpoint.binding.method,
      path: `/${segments.join("/")}`,
      segments,
      endpoint: compiledEndpoint.endpoint,
      parameters: compiledEndpoint.parameters,
    },
    compiledEndpoint,
  };
}

function indexRoutesByPath(
  routes: readonly CompiledHttpRoute[],
): ReadonlyMap<string, readonly CompiledHttpRoute[]> {
  const indexed = new Map<string, CompiledHttpRoute[]>();
  for (const route of routes) {
    const matches = indexed.get(route.route.path);
    if (matches === undefined) {
      indexed.set(route.route.path, [route]);
    } else {
      matches.push(route);
    }
  }
  return indexed;
}

async function resolveHttp(
  routesByPath: ReadonlyMap<string, readonly CompiledHttpRoute[]>,
  request: Request,
  maxBodyBytes: number,
): Promise<HttpRouterResult> {
  let path = "/";
  try {
    const url = new URL(request.url);
    path = url.pathname;
    const pathRoutes = routesByPath.get(path);
    if (pathRoutes === undefined) {
      return { kind: HTTP_ROUTER_RESULT_KIND.notFound, path };
    }
    const route = pathRoutes.find(
      (candidate) => candidate.route.method === request.method,
    );
    if (route === undefined) {
      return {
        kind: HTTP_ROUTER_RESULT_KIND.methodNotAllowed,
        path,
        allowed: uniqueMethods(pathRoutes),
      };
    }
    const rawResult =
      route.route.method === HTTP_METHOD.get
        ? rawGetInput(route, url)
        : await rawPostInput(route, request, maxBodyBytes);
    if (rawResult.kind !== HTTP_RAW_RESULT_KIND.raw) {
      return { ...rawResult, path };
    }
    return decodeHttpInput(route, rawResult.raw, request, path);
  } catch (error) {
    return { kind: HTTP_ROUTER_RESULT_KIND.internalError, path, error };
  }
}

function uniqueMethods(
  routes: readonly CompiledHttpRoute[],
): readonly (typeof routes)[number]["route"]["method"][] {
  return [...new Set(routes.map((route) => route.route.method))];
}

function rawGetInput(route: CompiledHttpRoute, url: URL): HttpRawResult {
  const unknownIssues = unknownParameterIssues(
    url.searchParams.keys(),
    route.compiledEndpoint.parameterNames,
  );
  if (unknownIssues.length > 0) {
    return { kind: HTTP_RAW_RESULT_KIND.invalidInput, issues: unknownIssues };
  }
  const raw = new Map<string, unknown>();
  for (const parameterName of route.compiledEndpoint.parameterNames) {
    const values = url.searchParams.getAll(parameterName);
    if (values.length === 0) {
      continue;
    }
    const parameter = route.compiledEndpoint.endpoint.entry.parameters.find(
      (candidate) => candidate.name === parameterName,
    );
    if (
      parameter?.codec.shape.kind !== VALUE_SHAPE_KIND.array &&
      values.length > 1
    ) {
      return {
        kind: HTTP_RAW_RESULT_KIND.invalidParameter,
        parameterName,
        issues: [`Parameter ${parameterName} accepts a single value`],
      };
    }
    raw.set(
      parameterName,
      parameter?.codec.shape.kind === VALUE_SHAPE_KIND.array
        ? values
        : values[0],
    );
  }
  return { kind: HTTP_RAW_RESULT_KIND.raw, raw: createRawValueMap(raw) };
}

async function rawPostInput(
  route: CompiledHttpRoute,
  request: Request,
  maxBodyBytes: number,
): Promise<HttpRawResult> {
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return invalidRawInput("Expected an application/json request body");
  }
  const body = await readRequestBody(request, maxBodyBytes);
  if (body.kind === HTTP_BODY_RESULT_KIND.tooLarge) {
    return invalidRawInput(`Request body exceeds ${maxBodyBytes} bytes`);
  }
  let parsed: unknown = {};
  if (body.text.length > 0) {
    try {
      parsed = JSON.parse(body.text) as unknown;
    } catch {
      return invalidRawInput("Request body is not valid JSON");
    }
  }
  if (!isJsonObject(parsed)) {
    return invalidRawInput("Request body must be a JSON object");
  }
  const unknownIssues = unknownParameterIssues(
    Object.keys(parsed),
    route.compiledEndpoint.parameterNames,
  );
  return unknownIssues.length > 0
    ? { kind: HTTP_RAW_RESULT_KIND.invalidInput, issues: unknownIssues }
    : {
        kind: HTTP_RAW_RESULT_KIND.raw,
        raw: createRawValueMap(Object.entries(parsed)),
      };
}

function mediaType(contentType: string | null): string | null {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function isJsonObject(value: unknown): value is RawValueMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRawValueMap(
  entries: Iterable<readonly [string, unknown]>,
): RawValueMap {
  const raw = Object.create(null) as RawValueMap;
  for (const [name, value] of entries) {
    Reflect.set(raw, name, value);
  }
  return raw;
}

async function readRequestBody(
  request: Request,
  maxBodyBytes: number,
): Promise<HttpBodyResult> {
  if (request.body === null) {
    return { kind: HTTP_BODY_RESULT_KIND.body, text: "" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    total += next.value.byteLength;
    if (total > maxBodyBytes) {
      void reader.cancel().catch(() => undefined);
      return { kind: HTTP_BODY_RESULT_KIND.tooLarge };
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    kind: HTTP_BODY_RESULT_KIND.body,
    text: new TextDecoder().decode(bytes),
  };
}

function unknownParameterIssues(
  names: Iterable<string>,
  parameterNames: readonly string[],
): readonly string[] {
  const exposed = new Set(parameterNames);
  return [...new Set(names)]
    .filter((name) => !exposed.has(name))
    .map((name) => `Unknown parameter: ${name}`);
}

function invalidRawInput(issue: string): HttpRawResult {
  return { kind: HTTP_RAW_RESULT_KIND.invalidInput, issues: [issue] };
}

function decodeHttpInput(
  route: CompiledHttpRoute,
  raw: RawValueMap,
  request: Request,
  path: string,
): HttpRouterResult {
  const decoded = decodeEntryInput({
    entry: route.compiledEndpoint.endpoint.entry,
    parameterNames: route.compiledEndpoint.parameterNames,
    raw,
    ...(route.route.method === HTTP_METHOD.get
      ? {
          coerce: (parameter, value) =>
            coerceStringValue(parameter.codec.shape, value),
        }
      : {}),
  });
  return mapDecodedResult(decoded, route.route.endpoint, request, path);
}

function mapDecodedResult(
  decoded: EntryDecodeResult<unknown>,
  endpoint: CompiledHttpRoute["route"]["endpoint"],
  request: Request,
  path: string,
): HttpRouterResult {
  switch (decoded.kind) {
    case ENTRY_DECODE_RESULT_KIND.resolved:
      return {
        kind: HTTP_ROUTER_RESULT_KIND.resolved,
        path,
        endpoint,
        projection: decoded.projection,
        request,
      };
    case ENTRY_DECODE_RESULT_KIND.invalidInput:
      return {
        kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
        path,
        issues: decoded.issues,
      };
    case ENTRY_DECODE_RESULT_KIND.invalidParameter:
      return {
        kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
        path,
        parameterName: decoded.parameterName,
        issues: decoded.issues,
      };
    case ENTRY_DECODE_RESULT_KIND.internalError:
      return {
        kind: HTTP_ROUTER_RESULT_KIND.internalError,
        path,
        error: decoded.error,
      };
  }
}
