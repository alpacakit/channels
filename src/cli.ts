import type { JsonValue } from "@alpacaloop/core";
import { coerceCliValue } from "./cli-coercion.js";
import { CLI_BOOLEAN_MODE } from "./cli-values.js";
import { requireParameter } from "./internal.js";
import type {
  EntryDefinition,
  ParameterSet,
  ParameterValues,
  RawValueMap,
  ValueShape,
} from "./model.js";
import { decodeParameterValues } from "./runtime.js";
import { ENTRY_DECODE_RESULT_KIND, VALUE_SHAPE_KIND } from "./values.js";

export const CLI_VALUE_KIND = {
  string: "string",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  boolean: "boolean",
} as const;

export type CliValueKind = (typeof CLI_VALUE_KIND)[keyof typeof CLI_VALUE_KIND];

export { CLI_BOOLEAN_MODE } from "./cli-values.js";

export interface CliParameterBinding<Name extends string = string> {
  readonly parameterName: Name;
  readonly flags: readonly string[];
}

export interface CliBinding<Parameters extends ParameterSet = ParameterSet> {
  readonly parameters: readonly CliParameterBinding<
    Parameters[number]["name"]
  >[];
}

type CliOptionDescriptorBase<Kind extends CliValueKind> = {
  readonly name: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly kind: Kind;
};

export type CliStringOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.string
> & {
  readonly multiple: false;
  readonly choices: readonly [];
  readonly booleanMode: null;
  readonly valueName: string;
  readonly defaultValue: string | null;
};

export type CliRepeatedStringOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.string
> & {
  readonly multiple: true;
  readonly choices: readonly [];
  readonly booleanMode: null;
  readonly valueName: string;
  readonly defaultValue: readonly string[] | null;
};

export type CliStringEnumOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.stringEnum
> & {
  readonly multiple: false;
  readonly choices: readonly string[];
  readonly booleanMode: null;
  readonly valueName: string;
  readonly defaultValue: string | null;
};

export type CliRepeatedStringEnumOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.stringEnum
> & {
  readonly multiple: true;
  readonly choices: readonly string[];
  readonly booleanMode: null;
  readonly valueName: string;
  readonly defaultValue: readonly string[] | null;
};

export type CliBooleanValueOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.boolean
> & {
  readonly multiple: false;
  readonly choices: readonly [];
  readonly booleanMode: typeof CLI_BOOLEAN_MODE.value;
  readonly valueName: string;
  readonly defaultValue: null;
};

export type CliBooleanFlagOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.boolean
> & {
  readonly multiple: false;
  readonly choices: readonly [];
  readonly booleanMode: typeof CLI_BOOLEAN_MODE.flag;
  readonly valueName: null;
  readonly defaultValue: boolean;
};

export type CliBooleanOptionDescriptor =
  | CliBooleanValueOptionDescriptor
  | CliBooleanFlagOptionDescriptor;

export type CliPositiveIntegerOptionDescriptor = CliOptionDescriptorBase<
  typeof CLI_VALUE_KIND.positiveInteger
> & {
  readonly multiple: false;
  readonly choices: readonly [];
  readonly booleanMode: null;
  readonly valueName: string;
  readonly defaultValue: number | null;
};

export type CliOptionDescriptor =
  | CliStringOptionDescriptor
  | CliRepeatedStringOptionDescriptor
  | CliStringEnumOptionDescriptor
  | CliRepeatedStringEnumOptionDescriptor
  | CliBooleanOptionDescriptor
  | CliPositiveIntegerOptionDescriptor;

const EmptyCliOptionChoices = [] as const;

export function booleanOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  defaultValue: boolean | null = null,
): CliBooleanOptionDescriptor {
  return defaultValue === null
    ? {
        name,
        flags,
        description,
        kind: CLI_VALUE_KIND.boolean,
        multiple: false,
        choices: EmptyCliOptionChoices,
        booleanMode: CLI_BOOLEAN_MODE.value,
        valueName: name,
        defaultValue,
      }
    : {
        name,
        flags,
        description,
        kind: CLI_VALUE_KIND.boolean,
        multiple: false,
        choices: EmptyCliOptionChoices,
        booleanMode: CLI_BOOLEAN_MODE.flag,
        valueName: null,
        defaultValue,
      };
}

export function stringOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  defaultValue: string | null = null,
): CliStringOptionDescriptor {
  return {
    name,
    flags,
    description,
    kind: CLI_VALUE_KIND.string,
    multiple: false,
    choices: EmptyCliOptionChoices,
    booleanMode: null,
    valueName: name,
    defaultValue,
  };
}

export function repeatedStringOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  defaultValue: readonly string[] | null = null,
): CliRepeatedStringOptionDescriptor {
  return {
    name,
    flags,
    description,
    kind: CLI_VALUE_KIND.string,
    multiple: true,
    choices: EmptyCliOptionChoices,
    booleanMode: null,
    valueName: name,
    defaultValue,
  };
}

export function positiveIntegerOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  defaultValue: number | null = null,
): CliPositiveIntegerOptionDescriptor {
  return {
    name,
    flags,
    description,
    kind: CLI_VALUE_KIND.positiveInteger,
    multiple: false,
    choices: EmptyCliOptionChoices,
    booleanMode: null,
    valueName: name,
    defaultValue,
  };
}

export function stringEnumOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  choices: readonly string[],
  defaultValue: string | null = null,
): CliStringEnumOptionDescriptor {
  return {
    name,
    flags,
    description,
    kind: CLI_VALUE_KIND.stringEnum,
    multiple: false,
    choices,
    booleanMode: null,
    valueName: name,
    defaultValue,
  };
}

export function repeatedStringEnumOptionDefinition(
  name: string,
  flags: readonly string[],
  description: string,
  choices: readonly string[],
  defaultValue: readonly string[] | null = null,
): CliRepeatedStringEnumOptionDescriptor {
  return {
    name,
    flags,
    description,
    kind: CLI_VALUE_KIND.stringEnum,
    multiple: true,
    choices,
    booleanMode: null,
    valueName: name,
    defaultValue,
  };
}

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
    return cliOptionDescriptorFor({
      name: parameter.name,
      flags: row.flags,
      description: parameter.description,
      shape: parameter.codec.shape,
      defaultValue: parameter.requirement.defaultValue,
    });
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
  const decoded = decodeParameterValues({
    parameters: input.entry.parameters,
    parameterNames: input.binding.parameters.map((row) => row.parameterName),
    raw: input.raw,
    coerce: (parameter, rawValue) =>
      coerceCliValue(parameter.codec.shape, rawValue),
  });
  if (decoded.kind === ENTRY_DECODE_RESULT_KIND.invalidInput) {
    throw new Error(
      `Invalid CLI option ${decoded.parameterName ?? "input"}: ${decoded.issues.join("; ")}`,
    );
  }
  return decoded.values;
}

function cliOptionDescriptorFor(input: {
  readonly name: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly shape: ValueShape;
  readonly defaultValue: JsonValue | undefined;
}): CliOptionDescriptor {
  const value = flattenCliValueShape(input.shape);
  if (value.multiple) {
    const defaultValue = optionalStringListDefault(
      input.defaultValue,
      input.name,
    );
    if (value.kind === CLI_VALUE_KIND.string) {
      return repeatedStringOptionDefinition(
        input.name,
        input.flags,
        input.description,
        defaultValue,
      );
    }
    if (value.kind === CLI_VALUE_KIND.stringEnum) {
      return repeatedStringEnumOptionDefinition(
        input.name,
        input.flags,
        input.description,
        value.choices,
        defaultValue,
      );
    }
    throw new Error(`Repeated ${value.kind} CLI options are not supported`);
  }

  switch (value.kind) {
    case CLI_VALUE_KIND.string:
      return stringOptionDefinition(
        input.name,
        input.flags,
        input.description,
        optionalStringDefault(input.defaultValue, input.name),
      );
    case CLI_VALUE_KIND.stringEnum:
      return stringEnumOptionDefinition(
        input.name,
        input.flags,
        input.description,
        value.choices,
        optionalStringDefault(input.defaultValue, input.name),
      );
    case CLI_VALUE_KIND.boolean:
      return booleanOptionDefinition(
        input.name,
        input.flags,
        input.description,
        optionalBooleanDefault(input.defaultValue, input.name),
      );
    case CLI_VALUE_KIND.positiveInteger:
      return positiveIntegerOptionDefinition(
        input.name,
        input.flags,
        input.description,
        optionalNumberDefault(input.defaultValue, input.name),
      );
  }
}

function optionalStringDefault(
  value: JsonValue | undefined,
  optionName: string,
): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`CLI option ${optionName} requires a string default`);
  }
  return value;
}

function optionalStringListDefault(
  value: JsonValue | undefined,
  optionName: string,
): readonly string[] | null {
  if (value === undefined) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`CLI option ${optionName} requires a string-list default`);
  }
  return value;
}

function optionalBooleanDefault(
  value: JsonValue | undefined,
  optionName: string,
): boolean | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`CLI option ${optionName} requires a boolean default`);
  }
  return value;
}

function optionalNumberDefault(
  value: JsonValue | undefined,
  optionName: string,
): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`CLI option ${optionName} requires a numeric default`);
  }
  return value;
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

export * from "./cli-model.js";
export { createCliRouter } from "./cli-tree.js";
