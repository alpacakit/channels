import type {
  ChannelSegmentOverride,
  TypedEntryChannelBinding,
} from "./model.js";
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
): TypedEntryChannelBinding<ChannelName, ParameterName> {
  return { channel, binding } as TypedEntryChannelBinding<
    ChannelName,
    ParameterName
  >;
}
