import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacaloop/core";
import {
  VALUE_SHAPE_KIND,
  type EntryDefinition,
  type ParameterSet,
  type ParameterValues,
  type RawValueMap,
  type ValueShape,
} from "./model.js";
import { requireParameter } from "./internal.js";

export const CLI_VALUE_KIND = {
  string: "string",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  boolean: "boolean",
} as const;

export type CliValueKind = (typeof CLI_VALUE_KIND)[keyof typeof CLI_VALUE_KIND];

export const CLI_BOOLEAN_MODE = {
  flag: "flag",
  value: "value",
} as const;

export type CliBooleanMode =
  (typeof CLI_BOOLEAN_MODE)[keyof typeof CLI_BOOLEAN_MODE];

export interface CliParameterBinding<Name extends string = string> {
  readonly parameterName: Name;
  readonly flags: readonly string[];
}

export interface CliBinding<Parameters extends ParameterSet = ParameterSet> {
  readonly parameters: readonly CliParameterBinding<
    Parameters[number]["name"]
  >[];
}

export type CliOptionDescriptor = {
  readonly name: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly kind: CliValueKind;
  readonly multiple: boolean;
  readonly choices: readonly string[];
  readonly booleanMode: CliBooleanMode | null;
  readonly defaultValue: JsonValue | undefined;
};

export function defineCliBinding<const Parameters extends ParameterSet>(
  binding: CliBinding<Parameters>,
): CliBinding<Parameters> {
  return binding;
}

export function createCliOptions<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly binding: CliBinding<Parameters>;
}): readonly CliOptionDescriptor[] {
  return input.binding.parameters.map((row) => {
    const parameter = requireParameter(
      input.entry.parameters,
      row.parameterName,
    );
    const value = flattenCliValueShape(parameter.codec.shape);
    return {
      name: parameter.name,
      flags: row.flags,
      description: parameter.description,
      kind: value.kind,
      multiple: value.multiple,
      choices: value.choices,
      booleanMode:
        value.kind === CLI_VALUE_KIND.boolean
          ? cliBooleanModeFor(parameter.requirement.defaultValue)
          : null,
      defaultValue: parameter.requirement.defaultValue,
    };
  });
}

export function parseCliValues<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly binding: CliBinding<Parameters>;
  readonly raw: RawValueMap;
}): ParameterValues<Parameters> {
  const output = new Map<string, JsonValue>();
  for (const row of input.binding.parameters) {
    const parameter = requireParameter(
      input.entry.parameters,
      row.parameterName,
    );
    const rawValue = input.raw[parameter.name];
    const value =
      rawValue === undefined
        ? parameter.requirement.defaultValue
        : coerceCliValue(parameter.codec.shape, rawValue);
    if (value === undefined) {
      continue;
    }
    const decoded = parameter.codec.decode(value);
    if (decoded.kind === CODEC_DECODE_RESULT_KIND.invalid) {
      throw new Error(
        `Invalid CLI option ${parameter.name}: ${decoded.issues.join("; ")}`,
      );
    }
    output.set(parameter.name, decoded.value);
  }
  return Object.fromEntries(output) as ParameterValues<Parameters>;
}

function cliBooleanModeFor(
  defaultValue: JsonValue | undefined,
): CliBooleanMode {
  // A bare flag can only produce `true`, so a boolean without a default (its
  // absence is a distinct state, and `false` must be expressible) has to render
  // as an explicit `--flag true|false`. A boolean with a default can use a flag,
  // where absence falls back to that default.
  return defaultValue === undefined
    ? CLI_BOOLEAN_MODE.value
    : CLI_BOOLEAN_MODE.flag;
}

function flattenCliValueShape(shape: ValueShape): {
  readonly kind: CliValueKind;
  readonly multiple: boolean;
  readonly choices: readonly string[];
} {
  switch (shape.kind) {
    case VALUE_SHAPE_KIND.array: {
      const element = flattenCliValueShape(shape.element);
      return { ...element, multiple: true };
    }
    case VALUE_SHAPE_KIND.positiveInteger:
      return {
        kind: CLI_VALUE_KIND.positiveInteger,
        multiple: false,
        choices: [],
      };
    case VALUE_SHAPE_KIND.stringEnum:
      return {
        kind: CLI_VALUE_KIND.stringEnum,
        multiple: false,
        choices: shape.values,
      };
    case VALUE_SHAPE_KIND.boolean:
      return {
        kind: CLI_VALUE_KIND.boolean,
        multiple: false,
        choices: [],
      };
    case VALUE_SHAPE_KIND.string:
      return {
        kind: CLI_VALUE_KIND.string,
        multiple: false,
        choices: [],
      };
    default: {
      const unreachable: never = shape;
      throw new Error(
        `Unsupported channel value shape: ${JSON.stringify(unreachable)}`,
      );
    }
  }
}

function coerceCliValue(
  shape: ValueShape,
  rawValue: unknown,
): JsonValue | undefined {
  if (shape.kind === VALUE_SHAPE_KIND.array) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    return values.map((value) => coerceCliScalarValue(shape.element, value));
  }
  return coerceCliScalarValue(shape, rawValue);
}

function coerceCliScalarValue(shape: ValueShape, value: unknown): JsonValue {
  if (shape.kind === VALUE_SHAPE_KIND.boolean) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return value as JsonValue;
}
