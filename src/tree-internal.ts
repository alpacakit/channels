import type { ChannelSegmentOverride, EntryChannelBinding } from "./model.js";
import type { Channel } from "./values.js";

export const PAYLOAD_KIND = {
  cliBinding: "cli_binding",
  cliSegment: "cli_segment",
  httpBinding: "http_binding",
  httpSegment: "http_segment",
  mcpBinding: "mcp_binding",
} as const;

type PayloadKind = (typeof PAYLOAD_KIND)[keyof typeof PAYLOAD_KIND];

const REGISTERED_PAYLOADS = new WeakMap<object, PayloadKind>();

export function registerChannelPayload(
  kind: PayloadKind,
  payload: object,
): void {
  REGISTERED_PAYLOADS.set(payload, kind);
}

export function isChannelPayload(kind: PayloadKind, value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    REGISTERED_PAYLOADS.get(value) === kind
  );
}

export function createChannelSegmentOverride(
  channel: Channel,
  segment: unknown,
): ChannelSegmentOverride {
  return { channel, segment } as ChannelSegmentOverride;
}

export function createEntryChannelBinding<
  const ChannelName extends Channel,
  const ParameterName extends string,
>(
  channel: ChannelName,
  binding: unknown,
): EntryChannelBinding<ChannelName, ParameterName> {
  return { channel, binding } as EntryChannelBinding<
    ChannelName,
    ParameterName
  >;
}
