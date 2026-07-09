import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacaloop/core";
import type { z } from "zod";
import {
  CHANNEL_PARAMETER_PRESENCE,
  requireChannelParameter,
  type ChannelEntryDefinition,
  type ChannelParameterSet,
  type ChannelParameterValues,
  type ChannelRawValueMap,
} from "./model.js";

export interface ChannelMcpParameterBinding<Name extends string = string> {
  readonly parameterName: Name;
}

export interface ChannelMcpBinding<
  Parameters extends ChannelParameterSet = ChannelParameterSet,
> {
  readonly parameters: readonly ChannelMcpParameterBinding<
    Parameters[number]["name"]
  >[];
}

export function defineMcpChannelBinding<
  const Parameters extends ChannelParameterSet,
>(binding: ChannelMcpBinding<Parameters>): ChannelMcpBinding<Parameters> {
  return binding;
}

export function createMcpChannelInputSchema<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(input: {
  readonly entry: ChannelEntryDefinition<Name, Parameters, Projection>;
  readonly binding: ChannelMcpBinding<Parameters>;
}): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const row of input.binding.parameters) {
    const parameter = requireChannelParameter(
      input.entry.parameters,
      row.parameterName,
    );
    const describedSchema = parameter.codec.schema.describe(
      parameter.description,
    );
    shape[parameter.name] =
      parameter.requirement.presence === CHANNEL_PARAMETER_PRESENCE.optional
        ? describedSchema.optional()
        : describedSchema;
  }
  return shape;
}

export function readMcpChannelParameterValues<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(input: {
  readonly entry: ChannelEntryDefinition<Name, Parameters, Projection>;
  readonly binding: ChannelMcpBinding<Parameters>;
  readonly raw: ChannelRawValueMap;
}): ChannelParameterValues<Parameters> {
  const output = new Map<string, JsonValue>();
  for (const row of input.binding.parameters) {
    const parameter = requireChannelParameter(
      input.entry.parameters,
      row.parameterName,
    );
    const rawValue = input.raw[parameter.name];
    const value =
      rawValue === undefined ? parameter.requirement.defaultValue : rawValue;
    if (value === undefined) {
      continue;
    }
    const decoded = parameter.codec.decode(value);
    if (decoded.kind === CODEC_DECODE_RESULT_KIND.invalid) {
      throw new Error(
        `Invalid MCP argument ${parameter.name}: ${decoded.issues.join("; ")}`,
      );
    }
    output.set(parameter.name, decoded.value);
  }
  return Object.fromEntries(output) as ChannelParameterValues<Parameters>;
}
