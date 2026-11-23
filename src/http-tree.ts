import {
  compileHttpBinding,
  isHttpEntryBinding,
  isHttpSegment,
} from "./http-compiler.js";
import type {
  HttpEntryBinding,
  HttpQueryMap,
  HttpRouteCollection,
} from "./http-model.js";
import { compileInputPlan } from "./input-compiler.js";
import type {
  EntryChannelBinding,
  EntryTreeEndpoint,
  EntryTreeNode,
  ErasedParameterDefinition,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import {
  type ContextFor,
  type EndpointForChannel,
  type EndpointsOfSource,
  type EntryTreeSource,
  type OutputFor,
  packRegistrationCollection,
} from "./registration.js";
import { EntryInputError } from "./runtime.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  formatTreePath,
  isEntryTreeDefinition,
  validateEntryTreeStructure,
} from "./schema.js";
import { coerceStringValue } from "./string-coercion.js";
import {
  CHANNEL,
  ENTRY_INPUT_TARGET_KIND,
  VALUE_SHAPE_KIND,
} from "./values.js";

type HttpEndpointFor<Source extends EntryTreeSource> = EndpointForChannel<
  EndpointsOfSource<Source>,
  typeof CHANNEL.http
>;

type ErasedHttpRegistration = {
  readonly endpoint: EntryTreeEndpoint;
  readonly method: string;
  readonly path: string;
};

export function collectHttpRoutes<const Source extends EntryTreeSource>(
  source: Source,
): HttpRouteCollection<
  ContextFor<HttpEndpointFor<Source>>,
  OutputFor<HttpEndpointFor<Source>>
> {
  const structuralIssues = validateEntryTreeStructure(source);
  if (structuralIssues.length > 0) {
    throw new EntryTreeDefinitionError(structuralIssues);
  }
  const issues: string[] = [];
  const registrations: ErasedHttpRegistration[] = [];
  const tree = isEntryTreeDefinition(source);
  const root = sourceRoot(source);
  const rootSegments = tree ? [] : [httpSegmentFor(root, [root.name], issues)];
  const pending: HttpFrame[] = [
    {
      node: root,
      logicalPath: [root.name],
      segments: rootSegments,
    },
  ];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) {
      continue;
    }
    compileNodeRoutes(frame, registrations, issues);
    for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
      const child = frame.node.children[index];
      if (child !== undefined) {
        const logicalPath = [...frame.logicalPath, child.name];
        pending.push({
          node: child,
          logicalPath,
          segments: [
            ...frame.segments,
            httpSegmentFor(child, logicalPath, issues),
          ],
        });
      }
    }
  }
  const unique = deduplicateRoutes(registrations, issues);
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  return packRegistrationCollection<
    HttpRouteCollection<
      ContextFor<HttpEndpointFor<Source>>,
      OutputFor<HttpEndpointFor<Source>>
    >
  >(unique);
}

function compileNodeRoutes(
  frame: HttpFrame,
  output: ErasedHttpRegistration[],
  issues: string[],
): void {
  const endpoints = [...new Set(frame.node.endpoints)];
  for (const endpoint of endpoints) {
    const channelBinding = findChannelBinding(endpoint, CHANNEL.http);
    if (channelBinding === null) {
      continue;
    }
    const location = `${formatTreePath(frame.logicalPath)}#${endpoint.entry.name}`;
    if (!isHttpChannelBinding(channelBinding)) {
      issues.push(`${location}: invalid HTTP endpoint binding`);
      continue;
    }
    const method = channelBinding.binding.method;
    if (method.length === 0 || /\s/u.test(method)) {
      issues.push(
        `${location}: HTTP method must be non-empty and contain no whitespace`,
      );
    }
    const compiled = compileHttpBinding(
      endpoint,
      channelBinding.binding,
      location,
      issues,
    );
    output.push(
      createHttpRegistration(
        endpoint,
        channelBinding,
        compiled,
        frame.segments,
      ),
    );
  }
}

function createHttpRegistration(
  endpoint: EntryTreeEndpoint,
  channelBinding: EntryChannelBinding,
  compiled: ReturnType<typeof compileHttpBinding>,
  segments: readonly string[],
) {
  const input = compileInputPlan({
    entry: endpoint.entry,
    bindings: compiled.parameterBindings,
  });
  const parseQuery = (raw: HttpQueryMap): unknown =>
    input.parseCoerced(raw, coerceHttpQueryValue);
  return ownedRecord({
    endpoint,
    entry: endpoint.entry,
    binding: channelBinding,
    method: compiled.binding.method,
    path: `/${segments.join("/")}`,
    segments: ownedArray(segments),
    parameters: compiled.parameters,
    input: ownedRecord({
      schema: input.schema,
      parse: input.parse,
      project: input.project,
      parseQuery,
    }),
    handler: endpoint.handler,
  });
}

function coerceHttpQueryValue(
  parameter: ErasedParameterDefinition,
  raw: unknown,
): unknown {
  const { shape } = parameter.codec;
  if (shape.kind === VALUE_SHAPE_KIND.json) {
    throw parameterInputError(
      parameter.name,
      "JSON parameters must be sent in the HTTP body",
    );
  }
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    if (!isHttpQueryValue(raw)) {
      throw parameterInputError(
        parameter.name,
        "HTTP query value must be a string or string array",
      );
    }
    return coerceStringValue(shape, raw);
  }
  const scalar = scalarQueryValue(parameter.name, raw);
  return coerceStringValue(shape, scalar);
}

function scalarQueryValue(parameterName: string, raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    throw parameterInputError(
      parameterName,
      "HTTP query scalar must be a string or one-element array",
    );
  }
  if (raw.length !== 1) {
    throw parameterInputError(
      parameterName,
      raw.length === 0
        ? "HTTP query scalar must not be an empty array"
        : "Duplicate HTTP query scalar",
    );
  }
  const value = raw[0];
  if (value === undefined) {
    throw parameterInputError(parameterName, "HTTP query scalar is missing");
  }
  return value;
}

function parameterInputError(
  parameterName: string,
  issue: string,
): EntryInputError {
  return new EntryInputError([issue], {
    kind: ENTRY_INPUT_TARGET_KIND.parameter,
    parameterName,
  });
}

function isHttpQueryValue(raw: unknown): raw is string | readonly string[] {
  return (
    typeof raw === "string" ||
    (Array.isArray(raw) && raw.every((item) => typeof item === "string"))
  );
}

function httpSegmentFor(
  node: EntryTreeNode,
  path: readonly string[],
  issues: string[],
): string {
  const override = node.segments.find((row) => row.channel === CHANNEL.http);
  let segment = node.name;
  if (override !== undefined) {
    if (!isHttpSegment(override.segment)) {
      issues.push(`${formatTreePath(path)}: invalid HTTP segment override`);
    } else {
      segment = override.segment.segment;
    }
  }
  if (
    segment.length === 0 ||
    segment.includes("/") ||
    /\s/u.test(segment) ||
    containsControlCharacter(segment)
  ) {
    issues.push(
      `${formatTreePath(path)}: HTTP segment must be non-empty and contain no slash, whitespace, or control character`,
    );
  }
  return segment;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function deduplicateRoutes(
  routes: readonly ErasedHttpRegistration[],
  issues: string[],
): readonly ErasedHttpRegistration[] {
  const indexed = new Map<string, ErasedHttpRegistration>();
  for (const route of routes) {
    const key = JSON.stringify([route.method, route.path]);
    const existing = indexed.get(key);
    if (existing === undefined) {
      indexed.set(key, route);
    } else if (existing.endpoint !== route.endpoint) {
      issues.push(
        `HTTP route ${route.method} ${route.path} is owned by different endpoints`,
      );
    }
  }
  return [...indexed.values()];
}

type HttpFrame = {
  readonly node: EntryTreeNode;
  readonly logicalPath: readonly string[];
  readonly segments: readonly string[];
};

function sourceRoot(source: EntryTreeSource): EntryTreeNode {
  return isEntryTreeDefinition(source) ? source.root : source;
}

function isHttpChannelBinding(
  binding: EntryChannelBinding,
): binding is EntryChannelBinding<typeof CHANNEL.http, HttpEntryBinding> {
  return (
    binding.channel === CHANNEL.http && isHttpEntryBinding(binding.binding)
  );
}
