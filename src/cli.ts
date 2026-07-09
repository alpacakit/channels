import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacaloop/core";
import {
  CHANNEL_VALUE_SHAPE_KIND,
  requireChannelParameter,
  type ChannelEntryDefinition,
  type ChannelParameterSet,
  type ChannelParameterValues,
  type ChannelRawValueMap,
  type ChannelValueShape,
} from "./model.js";

export const CHANNEL_CLI_VALUE_KIND = {
  string: "string",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  boolean: "boolean",
} as const;

export type ChannelCliValueKind =
  (typeof CHANNEL_CLI_VALUE_KIND)[keyof typeof CHANNEL_CLI_VALUE_KIND];

export const CHANNEL_CLI_BOOLEAN_MODE = {
  flag: "flag",
  value: "value",
} as const;

export type ChannelCliBooleanMode =
  (typeof CHANNEL_CLI_BOOLEAN_MODE)[keyof typeof CHANNEL_CLI_BOOLEAN_MODE];

export interface ChannelCliParameterBinding<Name extends string = string> {
  readonly parameterName: Name;
  readonly flags: readonly string[];
}

export interface ChannelCliBinding<
  Parameters extends ChannelParameterSet = ChannelParameterSet,
> {
  readonly parameters: readonly ChannelCliParameterBinding<
    Parameters[number]["name"]
  >[];
}

export type ChannelCliOptionDescriptor = {
  readonly name: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly kind: ChannelCliValueKind;
  readonly multiple: boolean;
  readonly choices: readonly string[];
  readonly booleanMode: ChannelCliBooleanMode | null;
  readonly defaultValue: JsonValue | undefined;
};

export function defineCliChannelBinding<
  const Parameters extends ChannelParameterSet,
>(binding: ChannelCliBinding<Parameters>): ChannelCliBinding<Parameters> {
  return binding;
}

export function createCliChannelOptions<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(input: {
  readonly entry: ChannelEntryDefinition<Name, Parameters, Projection>;
  readonly binding: ChannelCliBinding<Parameters>;
}): readonly ChannelCliOptionDescriptor[] {
  return input.binding.parameters.map((row) => {
    const parameter = requireChannelParameter(
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
        value.kind === CHANNEL_CLI_VALUE_KIND.boolean
          ? cliBooleanModeFor(parameter.requirement.defaultValue)
          : null,
      defaultValue: parameter.requirement.defaultValue,
    };
  });
}

export function readCliChannelParameterValues<
  const Name extends string,
  const Parameters extends ChannelParameterSet,
  Projection,
>(input: {
  readonly entry: ChannelEntryDefinition<Name, Parameters, Projection>;
  readonly binding: ChannelCliBinding<Parameters>;
  readonly raw: ChannelRawValueMap;
}): ChannelParameterValues<Parameters> {
  const output = new Map<string, JsonValue>();
  for (const row of input.binding.parameters) {
    const parameter = requireChannelParameter(
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
  return Object.fromEntries(output) as ChannelParameterValues<Parameters>;
}

function cliBooleanModeFor(
  defaultValue: JsonValue | undefined,
): ChannelCliBooleanMode {
  // A bare flag can only produce `true`, so a boolean without a default (its
  // absence is a distinct state, and `false` must be expressible) has to render
  // as an explicit `--flag true|false`. A boolean with a default can use a flag,
  // where absence falls back to that default.
  return defaultValue === undefined
    ? CHANNEL_CLI_BOOLEAN_MODE.value
    : CHANNEL_CLI_BOOLEAN_MODE.flag;
}

function flattenCliValueShape(shape: ChannelValueShape): {
  readonly kind: ChannelCliValueKind;
  readonly multiple: boolean;
  readonly choices: readonly string[];
} {
  switch (shape.kind) {
    case CHANNEL_VALUE_SHAPE_KIND.array: {
      const element = flattenCliValueShape(shape.element);
      return { ...element, multiple: true };
    }
    case CHANNEL_VALUE_SHAPE_KIND.positiveInteger:
      return {
        kind: CHANNEL_CLI_VALUE_KIND.positiveInteger,
        multiple: false,
        choices: [],
      };
    case CHANNEL_VALUE_SHAPE_KIND.stringEnum:
      return {
        kind: CHANNEL_CLI_VALUE_KIND.stringEnum,
        multiple: false,
        choices: shape.values,
      };
    case CHANNEL_VALUE_SHAPE_KIND.boolean:
      return {
        kind: CHANNEL_CLI_VALUE_KIND.boolean,
        multiple: false,
        choices: [],
      };
    case CHANNEL_VALUE_SHAPE_KIND.string:
      return {
        kind: CHANNEL_CLI_VALUE_KIND.string,
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
  shape: ChannelValueShape,
  rawValue: unknown,
): JsonValue | undefined {
  if (shape.kind === CHANNEL_VALUE_SHAPE_KIND.array) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    return values.map((value) => coerceCliScalarValue(shape.element, value));
  }
  return coerceCliScalarValue(shape, rawValue);
}

function coerceCliScalarValue(
  shape: ChannelValueShape,
  value: unknown,
): JsonValue {
  if (shape.kind === CHANNEL_VALUE_SHAPE_KIND.boolean) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return value as JsonValue;
}
