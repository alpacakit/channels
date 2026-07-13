import { findParameter } from "./internal.js";
import type {
  ErasedEntryDefinition,
  ErasedParameterDefinition,
} from "./model.js";
import { PARAMETER_REQUIREMENT_KIND } from "./values.js";

export const PARAMETER_BINDING_ISSUE_KIND = {
  duplicate: "duplicate",
  nonexistent: "nonexistent",
  requiredUnreachable: "required_unreachable",
} as const;

export type ParameterBindingRow = {
  readonly parameterName: string;
};

export type CompiledParameterBinding<
  Row extends ParameterBindingRow = ParameterBindingRow,
> = {
  readonly row: Row;
  readonly parameter: ErasedParameterDefinition;
};

export type ParameterBindingIssue =
  | {
      readonly kind: typeof PARAMETER_BINDING_ISSUE_KIND.duplicate;
      readonly parameterName: string;
    }
  | {
      readonly kind: typeof PARAMETER_BINDING_ISSUE_KIND.nonexistent;
      readonly parameterName: string;
    }
  | {
      readonly kind: typeof PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable;
      readonly parameterName: string;
    };

export type ParameterBindingCompilation<Row extends ParameterBindingRow> = {
  readonly bindings: readonly CompiledParameterBinding<Row>[];
  readonly issues: readonly ParameterBindingIssue[];
};

export function compileParameterBindings<Row extends ParameterBindingRow>(
  entry: ErasedEntryDefinition,
  rows: readonly Row[],
): ParameterBindingCompilation<Row> {
  const bindings: CompiledParameterBinding<Row>[] = [];
  const issues: ParameterBindingIssue[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    if (names.has(row.parameterName)) {
      issues.push({
        kind: PARAMETER_BINDING_ISSUE_KIND.duplicate,
        parameterName: row.parameterName,
      });
    }
    names.add(row.parameterName);
    const parameter = findParameter(entry.parameters, row.parameterName);
    if (parameter === null) {
      issues.push({
        kind: PARAMETER_BINDING_ISSUE_KIND.nonexistent,
        parameterName: row.parameterName,
      });
      continue;
    }
    bindings.push({ row, parameter });
  }
  for (const parameter of entry.parameters) {
    if (
      parameter.requirement.kind === PARAMETER_REQUIREMENT_KIND.required &&
      !names.has(parameter.name)
    ) {
      issues.push({
        kind: PARAMETER_BINDING_ISSUE_KIND.requiredUnreachable,
        parameterName: parameter.name,
      });
    }
  }
  return { bindings, issues };
}
