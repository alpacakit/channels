import type { ChannelSegmentOverride, EntryChannelBinding } from "./model.js";
import { ownedRecord } from "./owned.js";
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

export function createChannelSegmentOverride<
  const ChannelName extends Channel,
  Segment,
>(
  channel: ChannelName,
  segment: Segment,
): ChannelSegmentOverride<ChannelName, Segment> {
  return ownedRecord({ channel, segment }) as ChannelSegmentOverride<
    ChannelName,
    Segment
  >;
}

export function createEntryChannelBinding<
  const ChannelName extends Channel,
  Binding,
>(
  channel: ChannelName,
  binding: Binding,
): EntryChannelBinding<ChannelName, Binding> {
  return ownedRecord({ channel, binding }) as EntryChannelBinding<
    ChannelName,
    Binding
  >;
}
