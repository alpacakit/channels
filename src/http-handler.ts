import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacakit/core";
import { EntryOutputContractError, requireEntryOutput } from "./contract.js";
import { createEndpointHandlers } from "./endpoint-handlers.js";
import {
  HTTP_ROUTER_RESULT_KIND,
  type HttpResolvedEndpointResult,
  type HttpRouter,
  type HttpRouterResult,
} from "./http-model.js";
import type {
  EntryDefinition,
  EntryTreeEndpoint,
  ParameterSet,
} from "./model.js";
import { EntryInputError } from "./runtime.js";
import { ENTRY_INPUT_TARGET_KIND } from "./values.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export type HttpRequestHandler = (request: Request) => Promise<Response>;

export type HttpEndpointHandlerBinding<
  Endpoint extends EntryTreeEndpoint = EntryTreeEndpoint,
  Result extends JsonValue | Response = JsonValue | Response,
> = {
  readonly endpoint: Endpoint;
  readonly handler: (
    input: HttpResolvedEndpointResult<Endpoint>,
  ) => Result | Promise<Result>;
};

export type HttpEndpointHandlerRegistration = {
  readonly endpoint: EntryTreeEndpoint;
  readonly handler: (
    ...args: never[]
  ) => JsonValue | Response | Promise<JsonValue | Response>;
};

export class HttpHandlerDefinitionError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid HTTP handler definition:\n${issues.join("\n")}`);
    this.name = HttpHandlerDefinitionError.name;
  }
}

export function handleHttpEndpoint<
  const Endpoint extends EntryTreeEndpoint,
  Result extends JsonValue | Response,
>(
  endpoint: Endpoint,
  handler: (
    input: HttpResolvedEndpointResult<Endpoint>,
  ) => Result | Promise<Result>,
): HttpEndpointHandlerBinding<Endpoint, Result> {
  return { endpoint, handler };
}

export function createHttpHandler<
  const Bindings extends readonly HttpEndpointHandlerRegistration[],
>(
  router: HttpRouter,
  bindings: Bindings,
  options?: { readonly onError?: (error: unknown, request: Request) => void },
): HttpRequestHandler {
  const { issues, handlers } = createEndpointHandlers(
    router.endpoints,
    bindings,
  );
  if (issues.length > 0) {
    throw new HttpHandlerDefinitionError(issues);
  }
  return async (request) => {
    try {
      const result = await router.resolve(request);
      return await responseForRouterResult(
        result,
        request,
        handlers,
        options?.onError,
      );
    } catch (error) {
      return internalErrorResponse(error, request, options?.onError);
    }
  };
}

async function responseForRouterResult(
  result: HttpRouterResult,
  request: Request,
  handlers: ReadonlyMap<EntryTreeEndpoint, HttpEndpointHandlerRegistration>,
  onError: ((error: unknown, request: Request) => void) | undefined,
): Promise<Response> {
  switch (result.kind) {
    case HTTP_ROUTER_RESULT_KIND.resolved:
      return await responseForResolved(result, handlers, onError);
    case HTTP_ROUTER_RESULT_KIND.notFound:
      return jsonResponse(404, { error: { kind: result.kind } });
    case HTTP_ROUTER_RESULT_KIND.methodNotAllowed:
      return jsonResponse(
        405,
        { error: { kind: result.kind, allowed: result.allowed } },
        { allow: result.allowed.join(", ") },
      );
    case HTTP_ROUTER_RESULT_KIND.invalidInput:
      return jsonResponse(400, {
        error: { kind: result.kind, issues: result.issues },
      });
    case HTTP_ROUTER_RESULT_KIND.invalidParameter:
      return jsonResponse(400, {
        error: {
          kind: result.kind,
          parameterName: result.parameterName,
          issues: result.issues,
        },
      });
    case HTTP_ROUTER_RESULT_KIND.internalError:
      return internalErrorResponse(result.error, request, onError);
  }
}

async function responseForResolved(
  result: Extract<
    HttpRouterResult,
    { readonly kind: typeof HTTP_ROUTER_RESULT_KIND.resolved }
  >,
  handlers: ReadonlyMap<EntryTreeEndpoint, HttpEndpointHandlerRegistration>,
  onError: ((error: unknown, request: Request) => void) | undefined,
): Promise<Response> {
  const binding = handlers.get(result.endpoint);
  if (binding === undefined) {
    return internalErrorResponse(
      new HttpHandlerDefinitionError([
        `missing handler for endpoint ${result.endpoint.entry.name}`,
      ]),
      result.request,
      onError,
    );
  }
  try {
    const handler = binding.handler as unknown as (
      input: typeof result,
    ) => JsonValue | Response | Promise<JsonValue | Response>;
    const value = await handler(result);
    if (value instanceof Response) {
      return value;
    }
    verifyHandlerOutput(result.endpoint, value);
    return jsonResponse(200, value);
  } catch (error) {
    return responseForHandlerError(error, result, onError);
  }
}

function verifyHandlerOutput(
  endpoint: EntryTreeEndpoint,
  value: JsonValue,
): void {
  if (endpoint.entry.output === null) {
    return;
  }
  const entry = endpoint.entry as EntryDefinition<
    string,
    ParameterSet,
    unknown,
    JsonValue
  >;
  const decoded = requireEntryOutput(entry).decode(value);
  if (decoded.kind === CODEC_DECODE_RESULT_KIND.invalid) {
    throw new EntryOutputContractError(endpoint.entry.name, decoded.issues);
  }
}

function responseForHandlerError(
  error: unknown,
  result: Extract<
    HttpRouterResult,
    { readonly kind: typeof HTTP_ROUTER_RESULT_KIND.resolved }
  >,
  onError: ((error: unknown, request: Request) => void) | undefined,
): Response {
  if (error instanceof EntryInputError) {
    const target = error.target;
    if (target.kind === ENTRY_INPUT_TARGET_KIND.entry) {
      return jsonResponse(400, {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidInput,
          issues: error.issues,
        },
      });
    }
    if (
      result.endpoint.entry.parameters.some(
        (parameter) => parameter.name === target.parameterName,
      )
    ) {
      return jsonResponse(400, {
        error: {
          kind: HTTP_ROUTER_RESULT_KIND.invalidParameter,
          parameterName: target.parameterName,
          issues: error.issues,
        },
      });
    }
  }
  return internalErrorResponse(error, result.request, onError);
}

function internalErrorResponse(
  error: unknown,
  request: Request,
  onError: ((error: unknown, request: Request) => void) | undefined,
): Response {
  if (onError !== undefined) {
    try {
      onError(error, request);
    } catch {
      // Error reporting must not violate the request handler's no-rejection contract.
    }
  }
  return jsonResponse(500, {
    error: { kind: HTTP_ROUTER_RESULT_KIND.internalError },
  });
}

function jsonResponse(
  status: number,
  value: JsonValue,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(value), { status, headers });
}
