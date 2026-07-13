import type { JsonObject } from "@alpacaloop/core";
import type { z } from "zod";
import {
  type CompiledParameterBinding,
  compileParameterBindings,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import { requireEntryOutput } from "./contract.js";
import type {
  EntryChannelBinding,
  EntryDefinitionWithOutput,
  EntryTreeEndpoint,
  ParameterSet,
  RawValueMap,
} from "./model.js";
import { decodeEntryInput, type EntryDecodeResult } from "./runtime.js";
import { EntryTreeDefinitionError, findChannelBinding } from "./schema.js";
import {
  createEntryChannelBinding,
  isChannelPayload,
  PAYLOAD_KIND,
  registerChannelPayload,
} from "./tree-internal.js";
import {
  CHANNEL,
  ENTRY_DECODE_RESULT_KIND,
  PARAMETER_REQUIREMENT_KIND,
} from "./values.js";

const ZOD_SCHEMA_TYPE = {
  object: "object",
  readonly: "readonly",
} as const;

export type McpBinding<Parameters extends ParameterSet = ParameterSet> =
  readonly Parameters[number]["name"][];

export function bindMcpEntry<const ParameterNames extends readonly string[]>(
  ...parameterNames: ParameterNames
): EntryChannelBinding<typeof CHANNEL.mcp, ParameterNames[number]> {
  registerChannelPayload(PAYLOAD_KIND.mcpBinding, parameterNames);
  return createEntryChannelBinding(CHANNEL.mcp, parameterNames);
}

export type McpEntryParseResult<Entry extends EntryTreeEndpoint["entry"]> =
  EntryDecodeResult<ReturnType<Entry["project"]>>;

export type McpResolvedEntry<Entry extends EntryTreeEndpoint["entry"]> =
  Extract<
    McpEntryParseResult<Entry>,
    { readonly kind: typeof ENTRY_DECODE_RESULT_KIND.resolved }
  >;

/**
 * A compiled MCP endpoint. The binding is validated and compiled once by
 * `createMcpEndpoint()`, so definition errors surface eagerly (like the CLI
 * router) and `parse()` does no per-invocation recompilation.
 */
export interface McpEndpoint<Entry extends EntryTreeEndpoint["entry"]> {
  /** Raw Zod object shape for MCP tool registration. */
  readonly inputSchema: Record<string, z.ZodType>;
  /** Decode and project one MCP invocation through the endpoint. */
  parse(raw: RawValueMap): McpEntryParseResult<Entry>;
}

export function createMcpEndpoint<
  const Entry extends EntryTreeEndpoint["entry"],
>(endpoint: EntryTreeEndpoint<Entry>): McpEndpoint<Entry> {
  const bindings = resolveMcpBindings(endpoint);
  const parameterNames = bindings.map((binding) => binding.parameter.name);
  const inputSchema = buildMcpInputSchema(bindings);
  return {
    inputSchema,
    parse: (raw) =>
      decodeEntryInput({
        entry: endpoint.entry,
        parameterNames,
        raw,
      }),
  };
}

export function isMcpResolved<Entry extends EntryTreeEndpoint["entry"]>(
  result: McpEntryParseResult<Entry>,
): result is McpResolvedEntry<Entry> {
  return result.kind === ENTRY_DECODE_RESULT_KIND.resolved;
}

function buildMcpInputSchema(
  bindings: readonly CompiledParameterBinding[],
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const binding of bindings) {
    const { parameter } = binding;
    const describedSchema = parameter.codec.schema.describe(
      parameter.description,
    );
    shape[parameter.name] =
      parameter.requirement.kind !== PARAMETER_REQUIREMENT_KIND.required
        ? describedSchema.optional()
        : describedSchema;
  }
  return shape;
}

function resolveMcpBindings(
  endpoint: EntryTreeEndpoint,
): readonly CompiledParameterBinding[] {
  const channelBindings = endpoint.channels.filter(
    (candidate) => candidate.channel === CHANNEL.mcp,
  );
  const channelBinding = findChannelBinding(endpoint, CHANNEL.mcp);
  if (
    channelBindings.length !== 1 ||
    !channelBinding ||
    !isMcpBinding(channelBinding.binding)
  ) {
    throw new EntryTreeDefinitionError([
      `${endpoint.entry.name}: endpoint must have exactly one valid MCP binding`,
    ]);
  }
  const compilation = compileParameterBindings(
    endpoint.entry,
    channelBinding.binding.map((parameterName) => ({ parameterName })),
  );
  if (compilation.issues.length > 0) {
    throw new EntryTreeDefinitionError(
      compilation.issues.map((issue) =>
        formatMcpParameterBindingIssue(endpoint.entry.name, issue),
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
  return isChannelPayload(PAYLOAD_KIND.mcpBinding, value);
}

export function createMcpOutputSchema<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonObject,
>(
  endpoint: EntryTreeEndpoint<
    EntryDefinitionWithOutput<Name, Parameters, Projection, Output>
  >,
): z.ZodType<Output> {
  resolveMcpBindings(endpoint);
  const schema = requireEntryOutput(endpoint.entry).schema;
  const normalized =
    schema.type === ZOD_SCHEMA_TYPE.readonly ? unwrapZodSchema(schema) : schema;
  if (normalized.type !== ZOD_SCHEMA_TYPE.object) {
    throw new Error(
      `Entry ${endpoint.entry.name} output contract must use a Zod object schema`,
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
