import type { ParameterDescription } from "./introspection.js";
import type {
  ChannelSegmentOverride,
  EntryChannelBinding,
  EntryTreeEndpoint,
} from "./model.js";
import {
  createChannelSegmentOverride,
  createEntryChannelBinding,
  PAYLOAD_KIND,
  registerChannelPayload,
} from "./tree-internal.js";
import { CHANNEL } from "./values.js";

export const HTTP_METHOD = {
  get: "GET",
  post: "POST",
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export const HTTP_ROUTER_RESULT_KIND = {
  resolved: "resolved",
  notFound: "not_found",
  methodNotAllowed: "method_not_allowed",
  invalidInput: "invalid_input",
  invalidParameter: "invalid_parameter",
  internalError: "internal_error",
} as const;

export type HttpEntryBinding = {
  readonly method: HttpMethod;
  readonly exclude: readonly string[];
};

export type HttpSegment = {
  readonly segment: string;
};

export function bindHttpEntry<
  const Excluded extends readonly string[] = readonly [],
>(input?: {
  readonly method?: HttpMethod;
  readonly exclude?: Excluded;
}): EntryChannelBinding<typeof CHANNEL.http, Excluded[number]> {
  const payload = {
    method: input?.method ?? HTTP_METHOD.post,
    exclude: input?.exclude ?? [],
  } satisfies HttpEntryBinding;
  registerChannelPayload(PAYLOAD_KIND.httpBinding, payload);
  return createEntryChannelBinding(CHANNEL.http, payload);
}

export function overrideHttpSegment(segment: {
  readonly segment: string;
}): ChannelSegmentOverride {
  const payload = { segment: segment.segment } satisfies HttpSegment;
  registerChannelPayload(PAYLOAD_KIND.httpSegment, payload);
  return createChannelSegmentOverride(CHANNEL.http, payload);
}

export type HttpRouterResult =
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.resolved;
      readonly path: string;
      readonly endpoint: EntryTreeEndpoint;
      readonly projection: unknown;
      readonly request: Request;
    }
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.notFound;
      readonly path: string;
    }
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.methodNotAllowed;
      readonly path: string;
      readonly allowed: readonly HttpMethod[];
    }
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.invalidInput;
      readonly path: string;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.invalidParameter;
      readonly path: string;
      readonly parameterName: string;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof HTTP_ROUTER_RESULT_KIND.internalError;
      readonly path: string;
      readonly error: unknown;
    };

export type HttpResolvedEndpointResult<Endpoint extends EntryTreeEndpoint> =
  Omit<
    Extract<
      HttpRouterResult,
      { readonly kind: typeof HTTP_ROUTER_RESULT_KIND.resolved }
    >,
    "endpoint" | "projection"
  > & {
    readonly endpoint: Endpoint;
    readonly projection: ReturnType<Endpoint["entry"]["project"]>;
  };

export function isHttpResolvedEndpoint<
  const Endpoint extends EntryTreeEndpoint,
>(
  result: HttpRouterResult,
  endpoint: Endpoint,
): result is HttpResolvedEndpointResult<Endpoint> {
  return (
    result.kind === HTTP_ROUTER_RESULT_KIND.resolved &&
    result.endpoint === endpoint
  );
}

export type HttpRoute = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly segments: readonly string[];
  readonly endpoint: EntryTreeEndpoint;
  readonly parameters: readonly ParameterDescription[];
};

export interface HttpRouter {
  readonly routes: readonly HttpRoute[];
  readonly endpoints: readonly EntryTreeEndpoint[];
  resolve(request: Request): Promise<HttpRouterResult>;
}
