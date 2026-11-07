import { z } from "zod";
import type { CompiledParameterBinding } from "./binding-compiler.js";
import { EntryTreeDefinitionError } from "./definition-error.js";
import type { JsonValue } from "./json.js";
import type {
  ErasedEntryDefinition,
  ErasedParameterDefinition,
  ParameterValues,
  RawValueMap,
} from "./model.js";
import { copyJsonValue, ownedRecord } from "./owned.js";
import type { InputPlan } from "./registration.js";
import { EntryInputError } from "./runtime.js";
import {
  ENTRY_INPUT_TARGET_KIND,
  PARAMETER_REQUIREMENT_KIND,
} from "./values.js";

export type InputCoercer = (
  parameter: ErasedParameterDefinition,
  raw: unknown,
) => unknown;

export type CompiledInputPlan<
  Values extends RawValueMap = RawValueMap,
  Input = unknown,
> = InputPlan<Values, Input> & {
  readonly parameterNames: readonly string[];
  readonly parseCoerced: (raw: RawValueMap, coerce: InputCoercer) => Input;
};

export function compileInputPlan<
  const Entry extends ErasedEntryDefinition,
  Values extends RawValueMap = ParameterValues<Entry["parameters"]>,
>(input: {
  readonly entry: Entry;
  readonly bindings: readonly CompiledParameterBinding[];
}): CompiledInputPlan<Values, ReturnType<Entry["project"]>> {
  validateDefaults(input.entry);
  const exposedNames = input.bindings.map((binding) => binding.parameter.name);
  const exposed = new Set(exposedNames);
  const schema = buildInputSchema(input.bindings);
  const project = (values: Values): ReturnType<Entry["project"]> =>
    projectEntry(input.entry, exposed, values);
  const parseValues = (
    raw: RawValueMap,
    coerce?: InputCoercer,
  ): ReturnType<Entry["project"]> => {
    rejectUnknownKeys(raw, exposed);
    const candidate = coerce
      ? coerceRawValues(raw, input.bindings, coerce)
      : raw;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      throw entryInputError(parsed.error);
    }
    return project(parsed.data as Values);
  };
  return ownedRecord({
    schema: schema as z.ZodType<Values>,
    parse: (raw) => parseValues(raw),
    parseCoerced: (raw, coerce) => parseValues(raw, coerce),
    project,
    parameterNames: Object.freeze(exposedNames),
  });
}

function buildInputSchema(
  bindings: readonly CompiledParameterBinding[],
): z.ZodType<RawValueMap> {
  const shape: { [key: string]: z.ZodType } = Object.create(null);
  for (const { parameter } of bindings) {
    let schema: z.ZodType = parameter.codec.schema;
    switch (parameter.requirement.kind) {
      case PARAMETER_REQUIREMENT_KIND.required:
        break;
      case PARAMETER_REQUIREMENT_KIND.optional:
        schema = schema.optional();
        break;
      case PARAMETER_REQUIREMENT_KIND.optionalWithDefault: {
        const authoredDefault = parameter.requirement.defaultValue;
        schema = schema.prefault(() => copyJsonValue(authoredDefault));
        break;
      }
    }
    schema = schema.describe(parameter.description);
    Reflect.set(shape, parameter.name, schema);
  }
  return z.object(shape).strict() as z.ZodType<RawValueMap>;
}

function validateDefaults(entry: ErasedEntryDefinition): void {
  const issues: string[] = [];
  for (const parameter of entry.parameters) {
    if (
      parameter.requirement.kind !==
      PARAMETER_REQUIREMENT_KIND.optionalWithDefault
    ) {
      continue;
    }
    const parsed = parameter.codec.schema.safeParse(
      copyJsonValue(parameter.requirement.defaultValue),
    );
    if (!parsed.success) {
      issues.push(
        `${entry.name}#${parameter.name}: invalid authored default: ${formatZodIssues(parsed.error)}`,
      );
    }
  }
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
}

function projectEntry<Entry extends ErasedEntryDefinition>(
  entry: Entry,
  exposed: ReadonlySet<string>,
  publicValues: RawValueMap,
): ReturnType<Entry["project"]> {
  const values: { [key: string]: JsonValue } = Object.create(null);
  for (const parameter of entry.parameters) {
    if (exposed.has(parameter.name)) {
      if (Object.hasOwn(publicValues, parameter.name)) {
        Reflect.set(
          values,
          parameter.name,
          Reflect.get(publicValues, parameter.name),
        );
      }
      continue;
    }
    if (
      parameter.requirement.kind ===
      PARAMETER_REQUIREMENT_KIND.optionalWithDefault
    ) {
      const parsed = parameter.codec.schema.safeParse(
        copyJsonValue(parameter.requirement.defaultValue),
      );
      if (!parsed.success) {
        throw new Error(
          `Compiled default became invalid for ${entry.name}#${parameter.name}`,
        );
      }
      Reflect.set(values, parameter.name, parsed.data);
    }
  }
  const project = entry.project as unknown as (input: {
    readonly values: ParameterValues<Entry["parameters"]>;
  }) => ReturnType<Entry["project"]>;
  return project({ values: values as ParameterValues<Entry["parameters"]> });
}

function rejectUnknownKeys(
  raw: RawValueMap,
  exposed: ReadonlySet<string>,
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EntryInputError(["Entry input must be an object"]);
  }
  const unknown = Object.keys(raw).filter((key) => !exposed.has(key));
  if (unknown.length > 0) {
    throw new EntryInputError(unknown.map((key) => `Unknown parameter ${key}`));
  }
}

function coerceRawValues(
  raw: RawValueMap,
  bindings: readonly CompiledParameterBinding[],
  coerce: InputCoercer,
): RawValueMap {
  const output: RawValueMap = Object.create(null);
  for (const binding of bindings) {
    const name = binding.parameter.name;
    if (!Object.hasOwn(raw, name)) {
      continue;
    }
    Reflect.set(
      output,
      name,
      coerce(binding.parameter, Reflect.get(raw, name)),
    );
  }
  return output;
}

function entryInputError(error: z.ZodError): EntryInputError {
  const first = error.issues[0];
  const firstPath = first?.path[0];
  const target =
    typeof firstPath === "string"
      ? {
          kind: ENTRY_INPUT_TARGET_KIND.parameter,
          parameterName: firstPath,
        }
      : { kind: ENTRY_INPUT_TARGET_KIND.entry };
  return new EntryInputError(
    error.issues.map((issue) => issue.message),
    target,
  );
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
