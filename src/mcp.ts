import {
  CODEC_DECODE_RESULT_KIND,
  type JsonObject,
  type JsonValue,
} from "@alpacaloop/core";
import type { z } from "zod";
import {
  PARAMETER_PRESENCE,
  type EntryDefinition,
  type EntryDefinitionWithOutput,
  type ParameterSet,
  type ParameterValues,
  type RawValueMap,
} from "./model.js";
import { requireParameter } from "./internal.js";
import { requireEntryOutput } from "./contract.js";

const ZOD_SCHEMA_TYPE = {
  object: "object",
  readonly: "readonly",
} as const;

export interface McpParameterBinding<Name extends string = string> {
  readonly parameterName: Name;
}

export interface McpBinding<Parameters extends ParameterSet = ParameterSet> {
  readonly parameters: readonly McpParameterBinding<
    Parameters[number]["name"]
  >[];
}

export function defineMcpBinding<const Parameters extends ParameterSet>(
  binding: McpBinding<Parameters>,
): McpBinding<Parameters> {
  return binding;
}

export function createMcpInputSchema<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly binding: McpBinding<Parameters>;
}): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const row of input.binding.parameters) {
    const parameter = requireParameter(
      input.entry.parameters,
      row.parameterName,
    );
    const describedSchema = parameter.codec.schema.describe(
      parameter.description,
    );
    shape[parameter.name] =
      parameter.requirement.presence === PARAMETER_PRESENCE.optional
        ? describedSchema.optional()
        : describedSchema;
  }
  return shape;
}

export function createMcpOutputSchema<Output extends JsonObject>(input: {
  readonly entry: EntryDefinitionWithOutput<
    string,
    ParameterSet,
    unknown,
    Output
  >;
}): z.ZodType<Output> {
  const schema = requireEntryOutput(input.entry).schema;
  const normalized =
    schema.type === ZOD_SCHEMA_TYPE.readonly ? unwrapZodSchema(schema) : schema;
  if (normalized.type !== ZOD_SCHEMA_TYPE.object) {
    throw new Error(
      `Entry ${input.entry.name} output contract must use a Zod object schema`,
    );
  }
  return normalized;
}

function unwrapZodSchema<Output>(schema: z.ZodType<Output>): z.ZodType<Output> {
  const wrapper = schema as z.ZodType<Output> & {
    unwrap(): z.ZodType<Output>;
  };
  return wrapper.unwrap();
}

export function parseMcpValues<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly binding: McpBinding<Parameters>;
  readonly raw: RawValueMap;
}): ParameterValues<Parameters> {
  const output = new Map<string, JsonValue>();
  for (const row of input.binding.parameters) {
    const parameter = requireParameter(
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
  return Object.fromEntries(output) as ParameterValues<Parameters>;
}
