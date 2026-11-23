import {
  compileParameterExclusions,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import {
  HTTP_METHOD,
  type HttpEntryBinding,
  type HttpSegment,
} from "./http-model.js";
import { describeEntry, type ParameterDescription } from "./introspection.js";
import type { EntryTreeEndpoint } from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import { isChannelPayload, PAYLOAD_KIND } from "./tree-internal.js";
import { VALUE_SHAPE_KIND } from "./values.js";

export type CompiledHttpEndpoint = {
  readonly endpoint: EntryTreeEndpoint;
  readonly binding: HttpEntryBinding;
  readonly parameterBindings: ReturnType<
    typeof compileParameterExclusions
  >["bindings"];
  readonly parameterNames: readonly string[];
  readonly parameters: readonly ParameterDescription[];
};

export function compileHttpBinding(
  endpoint: EntryTreeEndpoint,
  binding: HttpEntryBinding,
  location: string,
  issues: string[],
): CompiledHttpEndpoint {
  const compilation = compileParameterExclusions(
    endpoint.entry,
    binding.exclude,
  );
  issues.push(
    ...compilation.issues.map((issue) =>
      formatHttpParameterBindingIssue(location, issue),
    ),
  );
  if (binding.method === HTTP_METHOD.get) {
    for (const { parameter } of compilation.bindings) {
      if (parameter.codec.shape.kind === VALUE_SHAPE_KIND.json) {
        issues.push(
          `${location}: HTTP GET cannot expose JSON parameter ${parameter.name}`,
        );
      }
    }
  }
  const parameterNames = compilation.bindings.map(
    (compiled) => compiled.parameter.name,
  );
  const exposed = new Set(parameterNames);
  return ownedRecord({
    endpoint,
    binding,
    parameterBindings: compilation.bindings,
    parameterNames: ownedArray(parameterNames),
    parameters: ownedArray(
      describeEntry(endpoint.entry).parameters.filter((parameter) =>
        exposed.has(parameter.name),
      ),
    ),
  });
}

export function isHttpEntryBinding(value: unknown): value is HttpEntryBinding {
  return isChannelPayload(PAYLOAD_KIND.httpBinding, value);
}

export function isHttpSegment(value: unknown): value is HttpSegment {
  return isChannelPayload(PAYLOAD_KIND.httpSegment, value);
}

function formatHttpParameterBindingIssue(
  location: string,
  issue: ParameterBindingIssue,
): string {
  switch (issue.kind) {
    case PARAMETER_BINDING_ISSUE_KIND.duplicate:
      return `${location}: duplicate exposed HTTP parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.duplicateExclusion:
      return `${location}: duplicate HTTP exclusion for parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistentExclusion:
      return `${location}: HTTP binding excludes nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistent:
      return `${location}: HTTP exposes nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable:
      return `${location}: required parameter ${issue.parameterName} is unreachable from HTTP`;
  }
}
