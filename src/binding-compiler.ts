import type { JsonValue } from "@alpacaloop/core";
import { findParameter } from "./internal.js";
import type {
  EntryDefinition,
  ParameterDefinition,
  ParameterSet,
} from "./model.js";
import { PARAMETER_PRESENCE } from "./values.js";

export const PARAMETER_BINDING_ISSUE_KIND = {
  duplicate: "duplicate",
  nonexistent: "nonexistent",
  requiredUnreachable: "required_unreachable",
} as const;

export interface ParameterBindingRow {
  readonly parameterName: string;
}

export interface CompiledParameterBinding<
  Row extends ParameterBindingRow = ParameterBindingRow,
> {
  readonly row: Row;
  readonly parameter: ParameterDefinition<string, JsonValue>;
}

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

export interface ParameterBindingCompilation<Row extends ParameterBindingRow> {
  readonly bindings: readonly CompiledParameterBinding<Row>[];
  readonly issues: readonly ParameterBindingIssue[];
}

export function compileParameterBindings<Row extends ParameterBindingRow>(
  entry: EntryDefinition<string, ParameterSet, unknown>,
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
      parameter.requirement.presence === PARAMETER_PRESENCE.required &&
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
