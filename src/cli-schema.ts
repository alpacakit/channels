import type { CliEntryBinding, CliSegment } from "./cli-model.js";
import { isChannelPayload, PAYLOAD_KIND } from "./tree-internal.js";

export function isCliSegment(value: unknown): value is CliSegment {
  return isChannelPayload(PAYLOAD_KIND.cliSegment, value);
}

export function isCliEntryBinding(value: unknown): value is CliEntryBinding {
  return isChannelPayload(PAYLOAD_KIND.cliBinding, value);
}
