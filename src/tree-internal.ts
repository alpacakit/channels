import type { ChannelSegmentOverride, EntryChannelBinding } from "./model.js";
import type { Channel } from "./values.js";

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
