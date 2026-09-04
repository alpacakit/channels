import {
  compileParameterBindings,
  PARAMETER_BINDING_ISSUE_KIND,
  type ParameterBindingIssue,
} from "./binding-compiler.js";
import { describeEntry, type ParameterDescription } from "./introspection.js";
import type { HttpEntryBinding, HttpSegment } from "./http-model.js";
import type { EntryTreeEndpoint } from "./model.js";
import { isChannelPayload, PAYLOAD_KIND } from "./tree-internal.js";

export type CompiledHttpEndpoint = {
  readonly endpoint: EntryTreeEndpoint;
  readonly binding: HttpEntryBinding;
  readonly parameterNames: readonly string[];
  readonly parameters: readonly ParameterDescription[];
};

export function compileHttpBinding(
  endpoint: EntryTreeEndpoint,
  binding: HttpEntryBinding,
  location: string,
  issues: string[],
): CompiledHttpEndpoint {
  validateHttpExclusions(endpoint, binding.exclude, location, issues);
  const excluded = new Set(binding.exclude);
  const compilation = compileParameterBindings(
    endpoint.entry,
    endpoint.entry.parameters
      .filter((parameter) => !excluded.has(parameter.name))
      .map((parameter) => ({ parameterName: parameter.name })),
  );
  issues.push(
    ...compilation.issues.map((issue) =>
      formatHttpParameterBindingIssue(location, issue),
    ),
  );
  const parameterNames = compilation.bindings.map(
    (compiled) => compiled.parameter.name,
  );
  const exposed = new Set(parameterNames);
  return {
    endpoint,
    binding,
    parameterNames,
    parameters: describeEntry(endpoint.entry).parameters.filter((parameter) =>
      exposed.has(parameter.name),
    ),
  };
}

export function isHttpEntryBinding(value: unknown): value is HttpEntryBinding {
  return isChannelPayload(PAYLOAD_KIND.httpBinding, value);
}

export function isHttpSegment(value: unknown): value is HttpSegment {
  return isChannelPayload(PAYLOAD_KIND.httpSegment, value);
}

function validateHttpExclusions(
  endpoint: EntryTreeEndpoint,
  exclusions: readonly string[],
  location: string,
  issues: string[],
): void {
  const names = new Set<string>();
  for (const name of exclusions) {
    if (names.has(name)) {
      issues.push(
        `${location}: duplicate HTTP exclusion for parameter ${name}`,
      );
    }
    names.add(name);
    if (
      !endpoint.entry.parameters.some((parameter) => parameter.name === name)
    ) {
      issues.push(
        `${location}: HTTP binding excludes nonexistent parameter ${name}`,
      );
    }
  }
}

function formatHttpParameterBindingIssue(
  location: string,
  issue: ParameterBindingIssue,
): string {
  switch (issue.kind) {
    case PARAMETER_BINDING_ISSUE_KIND.duplicate:
      return `${location}: duplicate exposed HTTP parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.nonexistent:
      return `${location}: HTTP exposes nonexistent parameter ${issue.parameterName}`;
    case PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable:
      return `${location}: required parameter ${issue.parameterName} is unreachable from HTTP`;
  }
}
