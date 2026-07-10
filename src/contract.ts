import {
  CODEC_DECODE_RESULT_KIND,
  createSchemaRuntimeCodec,
  type JsonValue,
} from "@alpacaloop/core";
import type { z } from "zod";
import type {
  EntryDefinition,
  EntryDefinitionWithOutput,
  OutputContract,
  ParameterSet,
} from "./model.js";

export function createOutputContract<Value extends JsonValue>(
  schema: z.ZodType<Value>,
): OutputContract<Value> {
  const { decode } = createSchemaRuntimeCodec(schema);
  return { schema, decode };
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

export function requireEntryOutput<Output extends JsonValue>(
  entry: EntryDefinition<string, ParameterSet, unknown, Output>,
): OutputContract<Output> {
  if (!entry.output) {
    throw new Error(`Entry ${entry.name} does not declare an output contract`);
  }
  return entry.output;
}

export function verifyEntryOutput<Output extends JsonValue>(
  entry: EntryDefinitionWithOutput<string, ParameterSet, unknown, Output>,
  value: NoInfer<Output>,
): Output {
  const decoded = requireEntryOutput(entry).decode(value);
  if (decoded.kind === CODEC_DECODE_RESULT_KIND.invalid) {
    throw new EntryOutputContractError(entry.name, decoded.issues);
  }
  return decoded.value;
}
