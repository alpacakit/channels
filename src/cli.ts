import { CLI_BOOLEAN_MODE } from "./cli-values.js";

export const CLI_VALUE_KIND = {
  string: "string",
  positiveInteger: "positive_integer",
  stringEnum: "string_enum",
  boolean: "boolean",
} as const;

type CliValueKind = (typeof CLI_VALUE_KIND)[keyof typeof CLI_VALUE_KIND];

export { CLI_BOOLEAN_MODE } from "./cli-values.js";

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

export * from "./cli-model.js";
export { createCliRouter } from "./cli-tree.js";
