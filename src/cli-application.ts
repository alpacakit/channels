import type {
  CliCommandPath,
  CliLongOptionFlag,
  CliOptionFlag,
} from "./cli-model.js";

const CLI_APPLICATION_SYNTAX = {
  optionPrefix: "-",
  positionalSeparator: "--",
} as const;

export const CLI_HELP_REQUEST_KIND = {
  path: "path",
} as const;

export type CliHelpRequest = {
  readonly kind: typeof CLI_HELP_REQUEST_KIND.path;
  readonly path: CliCommandPath;
  readonly all: boolean;
};

export type CliHelpRequestDefinition = {
  readonly commandToken: string;
  readonly optionTokens: readonly CliOptionFlag[];
  readonly allToken: CliLongOptionFlag;
};

export function parseCliHelpRequest(
  argv: readonly string[],
  definition: CliHelpRequestDefinition,
): CliHelpRequest | null {
  if (argv.length === 0) return pathHelpRequest([], false);
  if (argv[0] === definition.commandToken) {
    const args = argv.slice(1);
    if (
      args.length === 1 &&
      definition.optionTokens.includes(args[0] as CliOptionFlag)
    ) {
      return pathHelpRequest([], false);
    }
    if (args.at(-1) === definition.allToken) {
      return createPathHelpRequest(args.slice(0, -1), true);
    }
    return createPathHelpRequest(args, false);
  }
  const helpToken = argv.at(-1);
  if (!definition.optionTokens.includes(helpToken as CliOptionFlag)) {
    return null;
  }
  return createPathHelpRequest(argv.slice(0, -1), false);
}

function createPathHelpRequest(
  path: CliCommandPath,
  all: boolean,
): CliHelpRequest | null {
  return path.every(
    (token) => !token.startsWith(CLI_APPLICATION_SYNTAX.optionPrefix),
  )
    ? pathHelpRequest(path, all)
    : null;
}

function pathHelpRequest(path: CliCommandPath, all: boolean): CliHelpRequest {
  return { kind: CLI_HELP_REQUEST_KIND.path, path, all };
}

export const CLI_GLOBAL_OPTION_RESULT_KIND = {
  absent: "absent",
  invalid: "invalid",
  resolved: "resolved",
} as const;

export const CLI_GLOBAL_OPTION_ISSUE_KIND = {
  duplicate: "duplicate",
  invalidValue: "invalid_value",
} as const;

export type CliGlobalValueOptionDefinition<Value extends string = string> = {
  readonly flag: CliLongOptionFlag;
  readonly values: readonly Value[];
};

export type CliGlobalValueOptionResult<Value extends string = string> =
  | { readonly kind: typeof CLI_GLOBAL_OPTION_RESULT_KIND.absent }
  | {
      readonly kind: typeof CLI_GLOBAL_OPTION_RESULT_KIND.invalid;
      readonly issue:
        | typeof CLI_GLOBAL_OPTION_ISSUE_KIND.duplicate
        | typeof CLI_GLOBAL_OPTION_ISSUE_KIND.invalidValue;
    }
  | {
      readonly kind: typeof CLI_GLOBAL_OPTION_RESULT_KIND.resolved;
      readonly value: Value;
      readonly argv: readonly string[];
    };

export function extractCliGlobalValueOption<Value extends string>(
  argv: readonly string[],
  definition: CliGlobalValueOptionDefinition<Value>,
): CliGlobalValueOptionResult<Value> {
  const inlinePrefix = `${definition.flag}=`;
  const values: string[] = [];
  const normalized: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === CLI_APPLICATION_SYNTAX.positionalSeparator) {
      optionsEnded = true;
      normalized.push(token);
      continue;
    }
    if (!optionsEnded && token === definition.flag) {
      values.push(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (!optionsEnded && token?.startsWith(inlinePrefix) === true) {
      values.push(token.slice(inlinePrefix.length));
      continue;
    }
    if (token !== undefined) normalized.push(token);
  }
  if (values.length === 0) {
    return { kind: CLI_GLOBAL_OPTION_RESULT_KIND.absent };
  }
  if (values.length > 1) {
    return {
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.invalid,
      issue: CLI_GLOBAL_OPTION_ISSUE_KIND.duplicate,
    };
  }
  const value = values[0];
  if (!definition.values.includes(value as Value)) {
    return {
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.invalid,
      issue: CLI_GLOBAL_OPTION_ISSUE_KIND.invalidValue,
    };
  }
  return {
    kind: CLI_GLOBAL_OPTION_RESULT_KIND.resolved,
    value: value as Value,
    argv: normalized,
  };
}
