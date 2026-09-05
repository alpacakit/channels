import {
  compileParameterExclusions,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import { compileInputPlan } from "./input-compiler.js";
import { describeEntry, type ParameterDescription } from "./introspection.js";
import type {
  EntryChannelBinding,
  EntryTreeEndpoint,
  RawValueMap,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import type { InputPlan, Registration } from "./registration.js";
import {
  type ContextFor,
  type EndpointForChannel,
  type EndpointsOfSource,
  type EntryTreeSource,
  type OutputFor,
  packRegistrationCollection,
} from "./registration.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  validateEntryTreeStructure,
  visitEntryTreeSource,
} from "./schema.js";
import {
  createEntryChannelBinding,
  isChannelPayload,
  PAYLOAD_KIND,
  registerChannelPayload,
} from "./tree-internal.js";
import { CHANNEL } from "./values.js";

export type McpBinding<
  Name extends string = string,
  Excluded extends readonly string[] = readonly string[],
> = {
  readonly name: Name;
  readonly exclude: Excluded;
};

export function bindMcpEntry<
  const Name extends string,
  const Excluded extends readonly string[] = readonly [],
>(input: {
  readonly name: Name;
  readonly exclude?: Excluded;
}): EntryChannelBinding<typeof CHANNEL.mcp, McpBinding<Name, Excluded>> {
  const payload = ownedRecord({
    name: input.name,
    exclude: ownedArray(input.exclude ?? []),
  }) as McpBinding<Name, Excluded>;
  registerChannelPayload(PAYLOAD_KIND.mcpBinding, payload);
  return createEntryChannelBinding(CHANNEL.mcp, payload);
}

export type McpRegistration<
  Values extends RawValueMap,
  Input,
  Context,
  Output,
> = Omit<Registration<Values, Input, Context, Output>, "binding"> & {
  readonly binding: EntryChannelBinding<typeof CHANNEL.mcp, McpBinding>;
  readonly name: string;
  readonly parameters: readonly ParameterDescription[];
  readonly input: InputPlan<Values, Input>;
};

export interface McpToolCollection<Context, Output> {
  readonly length: number;
  readonly forEach: (
    visit: <Values extends RawValueMap, Input>(
      item: McpRegistration<Values, Input, Context, Output>,
    ) => void,
  ) => void;
}

type McpEndpointFor<Source extends EntryTreeSource> = EndpointForChannel<
  EndpointsOfSource<Source>,
  typeof CHANNEL.mcp
>;

type ErasedMcpRegistration = {
  readonly endpoint: EntryTreeEndpoint;
  readonly name: string;
};

export function collectMcpTools<const Source extends EntryTreeSource>(
  source: Source,
): McpToolCollection<
  ContextFor<McpEndpointFor<Source>>,
  OutputFor<McpEndpointFor<Source>>
> {
  const structuralIssues = validateEntryTreeStructure(source);
  if (structuralIssues.length > 0) {
    throw new EntryTreeDefinitionError(structuralIssues);
  }
  const issues: string[] = [];
  const registrations: ErasedMcpRegistration[] = [];
  const seenEndpoints = new Set<EntryTreeEndpoint>();
  visitEntryTreeSource(source, {
    visitNode() {},
    visitEndpoint(endpoint) {
      if (seenEndpoints.has(endpoint)) {
        return;
      }
      const channelBinding = findChannelBinding(endpoint, CHANNEL.mcp);
      if (channelBinding === null) {
        return;
      }
      seenEndpoints.add(endpoint);
      if (!isMcpChannelBinding(channelBinding)) {
        issues.push(`${endpoint.entry.name}: invalid MCP binding`);
        return;
      }
      const registration = compileMcpRegistration(
        endpoint,
        channelBinding,
        channelBinding.binding,
        issues,
      );
      registrations.push(registration);
    },
  });
  validateMcpNames(registrations, issues);
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  return packRegistrationCollection<
    McpToolCollection<
      ContextFor<McpEndpointFor<Source>>,
      OutputFor<McpEndpointFor<Source>>
    >
  >(registrations);
}

function compileMcpRegistration(
  endpoint: EntryTreeEndpoint,
  channelBinding: EntryChannelBinding,
  binding: McpBinding,
  issues: string[],
) {
  if (binding.name.trim().length === 0) {
    issues.push(`${endpoint.entry.name}: MCP name must not be blank`);
  }
  const compilation = compileParameterExclusions(
    endpoint.entry,
    binding.exclude,
  );
  issues.push(
    ...compilation.issues.map((issue) =>
      formatMcpParameterBindingIssue(endpoint.entry.name, issue),
    ),
  );
  const input = compileInputPlan({
    entry: endpoint.entry,
    bindings: compilation.bindings,
  });
  const exposed = new Set(input.parameterNames);
  return ownedRecord({
    endpoint,
    entry: endpoint.entry,
    binding: channelBinding,
    name: binding.name,
    parameters: ownedArray(
      describeEntry(endpoint.entry).parameters.filter((parameter) =>
        exposed.has(parameter.name),
      ),
    ),
    input: ownedRecord({
      schema: input.schema,
      parse: input.parse,
      project: input.project,
    }),
    handler: endpoint.handler,
  });
}

function validateMcpNames(
  registrations: readonly ErasedMcpRegistration[],
  issues: string[],
): void {
  const names = new Map<string, ErasedMcpRegistration>();
  for (const registration of registrations) {
    const existing = names.get(registration.name);
    if (existing !== undefined && existing.endpoint !== registration.endpoint) {
      issues.push(
        `MCP name ${JSON.stringify(registration.name)} is owned by different endpoints`,
      );
    } else {
      names.set(registration.name, registration);
    }
  }
}

function formatMcpParameterBindingIssue(
  entryName: string,
  issue: ParameterBindingIssue,
): string {
  switch (issue.kind) {
    case PARAMETER_BINDING_ISSUE_KIND.duplicate:
      return `${entryName}: duplicate exposed MCP parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.duplicateExclusion:
      return `${entryName}: duplicate MCP exclusion for parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistentExclusion:
      return `${entryName}: MCP excludes nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistent:
      return `${entryName}: MCP exposes nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable:
      return `${entryName}: required parameter ${issue.parameterName} is unreachable from MCP`;
  }
}

function isMcpBinding(value: unknown): value is McpBinding {
  return isChannelPayload(PAYLOAD_KIND.mcpBinding, value);
}

function isMcpChannelBinding(
  binding: EntryChannelBinding,
): binding is EntryChannelBinding<typeof CHANNEL.mcp, McpBinding> {
  return binding.channel === CHANNEL.mcp && isMcpBinding(binding.binding);
}
