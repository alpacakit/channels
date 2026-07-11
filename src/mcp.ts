import type { JsonObject } from "@alpacaloop/core";
import type { z } from "zod";
import {
  type CompiledParameterBinding,
  compileParameterBindings,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import { requireEntryOutput } from "./contract.js";
import { requireParameter } from "./internal.js";
import type {
  EntryDefinition,
  EntryDefinitionWithOutput,
  EntryTreeEndpoint,
  ParameterSet,
  ParameterValues,
  RawValueMap,
  TypedEntryChannelBinding,
} from "./model.js";
import { decodeParameterValues } from "./runtime.js";
import { EntryTreeDefinitionError, findChannelBinding } from "./schema.js";
import { createEntryChannelBinding } from "./tree-internal.js";
import {
  CHANNEL,
  ENTRY_DECODE_RESULT_KIND,
  PARAMETER_PRESENCE,
} from "./values.js";

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

export function defineMcpBinding<const Binding extends McpBinding>(
  binding: Binding,
): Binding;
export function defineMcpBinding<const Parameters extends ParameterSet>(
  binding: McpBinding<Parameters>,
): McpBinding<Parameters>;
export function defineMcpBinding(binding: McpBinding): McpBinding {
  return binding;
}

export function bindMcpEntry<
  const Binding extends {
    readonly parameters: readonly McpParameterBinding[];
  },
>(
  binding: Binding,
): TypedEntryChannelBinding<
  typeof CHANNEL.mcp,
  Binding["parameters"][number]["parameterName"]
> {
  return createEntryChannelBinding(CHANNEL.mcp, binding);
}

export function createMcpInputSchema<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly binding: McpBinding<Parameters>;
}): Record<string, z.ZodType>;
export function createMcpInputSchema(input: {
  readonly endpoint: EntryTreeEndpoint;
}): Record<string, z.ZodType>;
export function createMcpInputSchema(
  input:
    | {
        readonly entry: EntryDefinition<string, ParameterSet, unknown>;
        readonly binding: McpBinding;
      }
    | { readonly endpoint: EntryTreeEndpoint },
): Record<string, z.ZodType> {
  const bindings = resolveMcpBindings(input);
  const shape: Record<string, z.ZodType> = {};
  for (const binding of bindings) {
    const { parameter } = binding;
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

function resolveMcpBindings(
  input:
    | {
        readonly entry: EntryDefinition<string, ParameterSet, unknown>;
        readonly binding: McpBinding;
      }
    | { readonly endpoint: EntryTreeEndpoint },
): readonly CompiledParameterBinding<McpParameterBinding>[] {
  if ("entry" in input) {
    return input.binding.parameters.map((row) => ({
      row,
      parameter: requireParameter(input.entry.parameters, row.parameterName),
    }));
  }
  const channelBindings = input.endpoint.channels.filter(
    (candidate) => candidate.channel === CHANNEL.mcp,
  );
  const channelBinding = findChannelBinding(input.endpoint, CHANNEL.mcp);
  if (
    channelBindings.length !== 1 ||
    !channelBinding ||
    !isMcpBinding(channelBinding.binding)
  ) {
    throw new EntryTreeDefinitionError([
      `${input.endpoint.entry.name}: endpoint must have exactly one valid MCP binding`,
    ]);
  }
  const compilation = compileParameterBindings(
    input.endpoint.entry,
    channelBinding.binding.parameters,
  );
  if (compilation.issues.length > 0) {
    throw new EntryTreeDefinitionError(
      compilation.issues.map((issue) =>
        formatMcpParameterBindingIssue(input.endpoint.entry.name, issue),
      ),
    );
  }
  return compilation.bindings;
}

function formatMcpParameterBindingIssue(
  entryName: string,
  issue: ParameterBindingIssue,
): string {
  switch (issue.kind) {
    case PARAMETER_BINDING_ISSUE_KIND.duplicate:
      return `${entryName}: duplicate MCP binding for parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistent:
      return `${entryName}: MCP binding names nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable:
      return `${entryName}: required parameter ${issue.parameterName} is unreachable from MCP`;
  }
}

function isMcpBinding(value: unknown): value is McpBinding {
  if (
    typeof value !== "object" ||
    value === null ||
    !("parameters" in value) ||
    !Array.isArray(value.parameters)
  ) {
    return false;
  }
  return value.parameters.every(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      "parameterName" in row &&
      typeof row.parameterName === "string",
  );
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
  const decoded = decodeParameterValues({
    parameters: input.entry.parameters,
    parameterNames: input.binding.parameters.map((row) => row.parameterName),
    raw: input.raw,
  });
  if (decoded.kind === ENTRY_DECODE_RESULT_KIND.invalidInput) {
    throw new Error(
      `Invalid MCP argument ${decoded.parameterName ?? "input"}: ${decoded.issues.join("; ")}`,
    );
  }
  return decoded.values;
}
