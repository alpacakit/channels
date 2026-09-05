import type { ParameterDescription } from "./introspection.js";
import type {
  ChannelSegmentOverride,
  EntryChannelBinding,
  RawValueMap,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import type { InputPlan, Registration } from "./registration.js";
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

export type HttpMethod = string;

export type HttpEntryBinding<
  Method extends string = string,
  Excluded extends readonly string[] = readonly string[],
> = {
  readonly method: Method;
  readonly exclude: Excluded;
};

export type HttpSegment = {
  readonly segment: string;
};

export function bindHttpEntry<
  const Method extends string = typeof HTTP_METHOD.post,
  const Excluded extends readonly string[] = readonly [],
>(input?: {
  readonly method?: Method;
  readonly exclude?: Excluded;
}): EntryChannelBinding<
  typeof CHANNEL.http,
  HttpEntryBinding<Method, Excluded>
> {
  const payload = ownedRecord({
    method: input?.method ?? HTTP_METHOD.post,
    exclude: ownedArray(input?.exclude ?? []),
  }) as HttpEntryBinding<Method, Excluded>;
  registerChannelPayload(PAYLOAD_KIND.httpBinding, payload);
  return createEntryChannelBinding(CHANNEL.http, payload);
}

export function overrideHttpSegment(segment: {
  readonly segment: string;
}): ChannelSegmentOverride<typeof CHANNEL.http, HttpSegment> {
  const payload = ownedRecord({ segment: segment.segment });
  registerChannelPayload(PAYLOAD_KIND.httpSegment, payload);
  return createChannelSegmentOverride(CHANNEL.http, payload);
}

export type HttpQueryMap = {
  readonly [key: string]: string | readonly string[];
};

export type HttpInputPlan<Values extends RawValueMap, Input> = InputPlan<
  Values,
  Input
> & {
  readonly parseQuery: (raw: HttpQueryMap) => Input;
};

export type HttpRegistration<
  Values extends RawValueMap,
  Input,
  Context,
  Output,
> = Omit<Registration<Values, Input, Context, Output>, "binding" | "input"> & {
  readonly binding: EntryChannelBinding<typeof CHANNEL.http, HttpEntryBinding>;
  readonly method: string;
  readonly path: string;
  readonly segments: readonly string[];
  readonly parameters: readonly ParameterDescription[];
  readonly input: HttpInputPlan<Values, Input>;
};

export interface HttpRouteCollection<Context, Output> {
  readonly length: number;
  readonly forEach: (
    visit: <Values extends RawValueMap, Input>(
      item: HttpRegistration<Values, Input, Context, Output>,
    ) => void,
  ) => void;
}
