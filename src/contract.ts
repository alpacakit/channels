import type { z } from "zod";
import type { JsonValue } from "./json.js";
import type {
  EntryDefinition,
  EntryDefinitionWithOutput,
  ErasedEntryDefinition,
  OutputContract,
  ParameterSet,
} from "./model.js";

export function createOutputContract<Value extends JsonValue>(
  schema: z.ZodType<Value>,
): OutputContract<Value> {
  return Object.freeze({ schema });
}

export class EntryOutputContractError extends Error {
  constructor(
    readonly entryName: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid output for entry ${entryName}:\n${issues.join("\n")}`);
    this.name = EntryOutputContractError.name;
  }
}

export function requireEntryOutput<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
>(
  entry: EntryDefinition<Name, Parameters, Projection, Output>,
): OutputContract<Output> {
  if (entry.output === null) {
    throw new Error(`Entry ${entry.name} does not declare an output contract`);
  }
  return entry.output;
}

export function verifyEntryOutput<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
  Output extends JsonValue,
>(
  entry: EntryDefinitionWithOutput<Name, Parameters, Projection, Output>,
  value: NoInfer<Output>,
): Output {
  return verifyEntryOutputValue(entry, value) as Output;
}

function verifyEntryOutputValue(
  entry: ErasedEntryDefinition,
  value: JsonValue,
): JsonValue {
  if (entry.output === null) {
    throw new Error(`Entry ${entry.name} does not declare an output contract`);
  }
  const result = entry.output.schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "$"}: ${issue.message}`,
    );
    throw new EntryOutputContractError(
      entry.name,
      issues.length > 0 ? issues : [result.error.message],
    );
  }
  return result.data as JsonValue;
}
