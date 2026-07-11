import type { JsonValue } from "@alpacaloop/core";
import { coerceCliValue } from "./cli-coercion.js";
import {
  CLI_ARG_KIND,
  CLI_REPEAT_MODE,
  CLI_ROUTER_RESULT_KIND,
  type CliArgBinding,
  type CliBooleanMode,
  type CliEntryBinding,
  type CliHelpSurface,
  type CliRouter,
  type CliRouterResult,
  type CliSegment,
} from "./cli-model.js";
import { CLI_BOOLEAN_MODE } from "./cli-values.js";
import { findParameter } from "./internal.js";
import type {
  EntryTreeDefinition,
  EntryTreeEndpoint,
  EntryTreeNode,
  ParameterDefinition,
  RawValueMap,
  ValueShape,
} from "./model.js";
import { decodeEntryInput } from "./runtime.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  formatTreePath,
  validateEntryTreeStructure,
  visitEntryTree,
} from "./schema.js";
import {
  CHANNEL,
  ENTRY_DECODE_RESULT_KIND,
  PARAMETER_PRESENCE,
  VALUE_SHAPE_KIND,
} from "./values.js";

const CLI_POSITIONAL_SEPARATOR = "--";

interface CompiledCliEndpoint {
  readonly endpoint: EntryTreeEndpoint;
  readonly binding: CliEntryBinding;
  readonly options: readonly Extract<
    CliArgBinding,
    { readonly kind: "option" }
  >[];
  readonly positionals: readonly Extract<
    CliArgBinding,
    { readonly kind: "positional" }
  >[];
}

interface CompiledCliNode {
  readonly source: EntryTreeNode;
  readonly path: readonly string[];
  readonly segment: CliSegment;
  readonly endpoint: CompiledCliEndpoint | null;
  readonly children: readonly CompiledCliNode[];
  readonly childByToken: ReadonlyMap<string, CompiledCliNode>;
}

export function createCliRouter(tree: EntryTreeDefinition): CliRouter {
  const root = compileCliTree(tree);
  return {
    help: createHelpSurface(root, true),
    resolve: (argv) => resolveCli(root, argv),
  };
}

function compileCliTree(tree: EntryTreeDefinition): CompiledCliNode {
  const issues = [...validateEntryTreeStructure(tree)];
  const nodeRecords = new Map<
    EntryTreeNode,
    {
      readonly path: readonly string[];
      readonly segment: CliSegment;
      readonly endpoint: CompiledCliEndpoint | null;
    }
  >();

  visitEntryTree(tree, {
    visitNode(node, path) {
      nodeRecords.set(node, {
        path,
        segment: cliSegmentFor(node, path, issues),
        endpoint: cliEndpointFor(node, path, issues),
      });
    },
    visitEndpoint() {},
  });

  const publicNodes = new Map<EntryTreeNode, CompiledCliNode>();
  const pending: EntryTreeNode[] = [];
  visitEntryTree(tree, {
    visitNode(node) {
      pending.push(node);
    },
    visitEndpoint() {},
  });
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const node = pending[index];
    if (!node) {
      continue;
    }
    const record = nodeRecords.get(node);
    if (!record) {
      continue;
    }
    const children = node.children.flatMap((child) => {
      const compiled = publicNodes.get(child);
      return compiled ? [compiled] : [];
    });
    if (
      record.endpoint === null &&
      children.length === 0 &&
      node !== tree.root
    ) {
      continue;
    }
    validateCliChildren(record.path, children, issues);
    if (
      record.endpoint !== null &&
      record.endpoint.positionals.length > 0 &&
      children.length > 0
    ) {
      issues.push(
        `${formatTreePath(record.path)}: executable CLI node cannot have both positionals and children`,
      );
    }
    const childByToken = new Map<string, CompiledCliNode>();
    for (const child of children) {
      childByToken.set(child.segment.token, child);
      for (const alias of child.segment.aliases) {
        childByToken.set(alias, child);
      }
    }
    publicNodes.set(node, {
      source: node,
      path: record.path,
      segment: record.segment,
      endpoint: record.endpoint,
      children,
      childByToken,
    });
  }

  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  const root = publicNodes.get(tree.root);
  if (!root) {
    throw new EntryTreeDefinitionError([
      "entry tree has no public CLI endpoint",
    ]);
  }
  return root;
}

function cliSegmentFor(
  node: EntryTreeNode,
  path: readonly string[],
  issues: string[],
): CliSegment {
  const override = node.segments.find((row) => row.channel === CHANNEL.cli);
  if (!override) {
    return { token: node.name, aliases: [] };
  }
  if (!isCliSegment(override.segment)) {
    issues.push(`${formatTreePath(path)}: invalid CLI segment override`);
    return { token: node.name, aliases: [] };
  }
  if (override.segment.token.length === 0) {
    issues.push(`${formatTreePath(path)}: CLI segment token must not be empty`);
  }
  return override.segment;
}

function cliEndpointFor(
  node: EntryTreeNode,
  path: readonly string[],
  issues: string[],
): CompiledCliEndpoint | null {
  const endpoints = node.endpoints.flatMap((endpoint) =>
    findChannelBinding(endpoint, CHANNEL.cli) ? [endpoint] : [],
  );
  if (endpoints.length > 1) {
    issues.push(`${formatTreePath(path)}: more than one public CLI endpoint`);
  }
  const endpoint = endpoints[0];
  if (!endpoint) {
    return null;
  }
  const channelBinding = findChannelBinding(endpoint, CHANNEL.cli);
  if (!channelBinding || !isCliEntryBinding(channelBinding.binding)) {
    issues.push(`${formatTreePath(path)}: invalid CLI endpoint binding`);
    return null;
  }
  validateCliBinding(endpoint, channelBinding.binding, path, issues);
  return {
    endpoint,
    binding: channelBinding.binding,
    options: channelBinding.binding.parameters.filter(isCliOptionBinding),
    positionals: channelBinding.binding.parameters.filter(
      isCliPositionalBinding,
    ),
  };
}

function validateCliBinding(
  endpoint: EntryTreeEndpoint,
  binding: CliEntryBinding,
  path: readonly string[],
  issues: string[],
): void {
  const location = `${formatTreePath(path)}#${endpoint.entry.name}`;
  const parameterNames = new Set<string>();
  const optionFlags = new Set<string>();
  const positionals = binding.parameters.filter(isCliPositionalBinding);
  for (const row of binding.parameters) {
    if (parameterNames.has(row.parameterName)) {
      issues.push(
        `${location}: duplicate binding for parameter ${row.parameterName}`,
      );
    }
    parameterNames.add(row.parameterName);
    const parameter = findParameter(
      endpoint.entry.parameters,
      row.parameterName,
    );
    if (!parameter) {
      issues.push(
        `${location}: binding names nonexistent parameter ${row.parameterName}`,
      );
      continue;
    }
    if (row.kind === CLI_ARG_KIND.option) {
      validateCliOption(row, parameter, location, optionFlags, issues);
    } else {
      validateCliPositional(row, parameter, location, issues);
      const positionalIndex = positionals.indexOf(row);
      if (row.variadic && positionalIndex !== positionals.length - 1) {
        issues.push(
          `${location}: variadic positional ${row.parameterName} must be last`,
        );
      }
    }
  }
  for (const parameter of endpoint.entry.parameters) {
    if (
      parameter.requirement.presence === PARAMETER_PRESENCE.required &&
      !parameterNames.has(parameter.name)
    ) {
      issues.push(
        `${location}: required parameter ${parameter.name} is unreachable from CLI`,
      );
    }
  }
}

function validateCliOption(
  row: Extract<CliArgBinding, { readonly kind: "option" }>,
  parameter: ParameterDefinition<string, JsonValue>,
  location: string,
  optionFlags: Set<string>,
  issues: string[],
): void {
  if (row.flags.length === 0) {
    issues.push(`${location}: option ${row.parameterName} must declare a flag`);
  }
  for (const flag of row.flags) {
    if (optionFlags.has(flag)) {
      issues.push(`${location}: duplicate CLI option flag ${flag}`);
    }
    optionFlags.add(flag);
  }
  const shape = parameter.codec.shape;
  const isBoolean = shape.kind === VALUE_SHAPE_KIND.boolean;
  const isArray = shape.kind === VALUE_SHAPE_KIND.array;
  if (row.booleanMode !== undefined && !isBoolean) {
    issues.push(
      `${location}: booleanMode contradicts ${row.parameterName} codec shape`,
    );
  }
  if (row.repeatMode !== undefined && !isArray) {
    issues.push(
      `${location}: repeatMode contradicts ${row.parameterName} codec shape`,
    );
  }
  if (row.negated !== undefined && !isBoolean) {
    issues.push(
      `${location}: negated contradicts ${row.parameterName} codec shape`,
    );
  }
  if (
    row.negated &&
    effectiveBooleanMode(row, parameter) !== CLI_BOOLEAN_MODE.flag
  ) {
    issues.push(
      `${location}: negated option ${row.parameterName} requires flag booleanMode`,
    );
  }
}

function validateCliPositional(
  row: Extract<CliArgBinding, { readonly kind: "positional" }>,
  parameter: ParameterDefinition<string, JsonValue>,
  location: string,
  issues: string[],
): void {
  const isArray = parameter.codec.shape.kind === VALUE_SHAPE_KIND.array;
  if (row.variadic !== isArray) {
    issues.push(
      `${location}: positional ${row.parameterName} variadic mode contradicts codec shape`,
    );
  }
  if (row.valueName.length === 0) {
    issues.push(
      `${location}: positional ${row.parameterName} valueName must not be empty`,
    );
  }
}

function validateCliChildren(
  path: readonly string[],
  children: readonly CompiledCliNode[],
  issues: string[],
): void {
  const tokens = new Map<string, string>();
  for (const child of children) {
    for (const token of [child.segment.token, ...child.segment.aliases]) {
      const owner = tokens.get(token);
      if (owner !== undefined) {
        issues.push(
          `${formatTreePath(path)}: CLI sibling token/alias collision ${JSON.stringify(token)} between ${owner} and ${child.source.name}`,
        );
      } else {
        tokens.set(token, child.source.name);
      }
    }
  }
}

function resolveCli(
  root: CompiledCliNode,
  argv: readonly string[],
): CliRouterResult {
  let node = root;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token || token === CLI_POSITIONAL_SEPARATOR || token.startsWith("-")) {
      break;
    }
    const child = node.childByToken.get(token);
    if (!child) {
      break;
    }
    node = child;
    index += 1;
  }

  const unmatchedToken = argv[index];
  if (
    node.endpoint !== null &&
    node.children.length > 0 &&
    unmatchedToken !== undefined &&
    unmatchedToken !== CLI_POSITIONAL_SEPARATOR &&
    !unmatchedToken.startsWith("-")
  ) {
    return {
      kind: CLI_ROUTER_RESULT_KIND.unknownCommand,
      path: node.path,
      token: unmatchedToken,
    };
  }
  if (node.endpoint === null) {
    return unmatchedToken === undefined
      ? { kind: CLI_ROUTER_RESULT_KIND.incompleteCommand, path: node.path }
      : {
          kind: CLI_ROUTER_RESULT_KIND.unknownCommand,
          path: node.path,
          token: unmatchedToken,
        };
  }
  const rawResult = parseCliArguments(node.endpoint, argv.slice(index));
  if (rawResult.kind === CLI_ROUTER_RESULT_KIND.invalidInput) {
    return { ...rawResult, path: node.path };
  }
  const entry = node.endpoint.endpoint.entry;
  const decoded = decodeEntryInput({
    entry,
    parameterNames: node.endpoint.binding.parameters.map(
      (row) => row.parameterName,
    ),
    raw: rawResult.raw,
    coerce: (parameter, rawValue) =>
      coerceCliValue(parameter.codec.shape, rawValue),
  });
  switch (decoded.kind) {
    case ENTRY_DECODE_RESULT_KIND.resolved:
      return {
        kind: CLI_ROUTER_RESULT_KIND.resolved,
        path: node.path,
        endpoint: node.endpoint.endpoint,
        entry,
        values: decoded.values,
        projection: decoded.projection,
      };
    case ENTRY_DECODE_RESULT_KIND.invalidInput:
      return {
        kind: CLI_ROUTER_RESULT_KIND.invalidInput,
        path: node.path,
        parameterName: decoded.parameterName,
        issues: decoded.issues,
      };
    case ENTRY_DECODE_RESULT_KIND.internalError:
      return {
        kind: CLI_ROUTER_RESULT_KIND.internalError,
        path: node.path,
        error: decoded.error,
      };
  }
}

type InvalidCliResult = {
  readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidInput;
  readonly parameterName: string | null;
  readonly issues: readonly string[];
};

type RawCliResult =
  | { readonly kind: "raw"; readonly raw: RawValueMap }
  | InvalidCliResult;

function parseCliArguments(
  endpoint: CompiledCliEndpoint,
  argv: readonly string[],
): RawCliResult {
  const raw = new Map<string, unknown>();
  const options = createCliOptionIndexes(endpoint);
  const positionalValues: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (!positionalOnly && token === CLI_POSITIONAL_SEPARATOR) {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && token.startsWith("-")) {
      const parsed = parseCliOption({ endpoint, argv, index, raw, ...options });
      if (parsed.kind === CLI_ROUTER_RESULT_KIND.invalidInput) {
        return parsed;
      }
      if (parsed.consumedNext) {
        index += 1;
      }
      continue;
    }
    positionalValues.push(token);
  }
  return bindCliPositionals(endpoint, positionalValues, raw);
}

type CliOptionBinding = Extract<
  CliArgBinding,
  { readonly kind: typeof CLI_ARG_KIND.option }
>;

function createCliOptionIndexes(endpoint: CompiledCliEndpoint): {
  readonly optionByFlag: ReadonlyMap<string, CliOptionBinding>;
  readonly negatedFlags: ReadonlyMap<string, CliOptionBinding>;
} {
  const optionByFlag = new Map<string, CliOptionBinding>();
  const negatedFlags = new Map<string, CliOptionBinding>();
  for (const option of endpoint.options) {
    for (const flag of option.flags) {
      optionByFlag.set(flag, option);
      if (option.negated && flag.startsWith("--")) {
        negatedFlags.set(`--no-${flag.slice(2)}`, option);
      }
    }
  }
  return { optionByFlag, negatedFlags };
}

function parseCliOption(input: {
  readonly endpoint: CompiledCliEndpoint;
  readonly argv: readonly string[];
  readonly index: number;
  readonly raw: Map<string, unknown>;
  readonly optionByFlag: ReadonlyMap<string, CliOptionBinding>;
  readonly negatedFlags: ReadonlyMap<string, CliOptionBinding>;
}):
  | { readonly kind: "parsed"; readonly consumedNext: boolean }
  | InvalidCliResult {
  const token = input.argv[input.index] ?? "";
  const [flag, inlineValue] = splitOptionToken(token);
  const negated = input.negatedFlags.get(flag);
  if (negated) {
    if (inlineValue !== undefined) {
      return invalidCliInput(
        negated.parameterName,
        `${flag} does not take a value`,
      );
    }
    input.raw.set(negated.parameterName, false);
    return { kind: "parsed", consumedNext: false };
  }
  const option = input.optionByFlag.get(flag);
  if (!option) {
    return invalidCliInput(null, `Unknown option ${flag}`);
  }
  const parameter = findParameter(
    input.endpoint.endpoint.entry.parameters,
    option.parameterName,
  );
  if (!parameter) {
    return invalidCliInput(
      option.parameterName,
      `Unknown parameter ${option.parameterName}`,
    );
  }
  if (effectiveBooleanMode(option, parameter) === CLI_BOOLEAN_MODE.flag) {
    if (inlineValue !== undefined) {
      return invalidCliInput(
        option.parameterName,
        `${flag} does not take a value`,
      );
    }
    input.raw.set(option.parameterName, true);
    return { kind: "parsed", consumedNext: false };
  }
  const value = inlineValue ?? input.argv[input.index + 1];
  if (value === undefined) {
    return invalidCliInput(option.parameterName, `${flag} requires a value`);
  }
  storeOptionValue(input.raw, option, parameter.codec.shape, value);
  return { kind: "parsed", consumedNext: inlineValue === undefined };
}

function bindCliPositionals(
  endpoint: CompiledCliEndpoint,
  positionalValues: readonly string[],
  raw: Map<string, unknown>,
): RawCliResult {
  let positionalIndex = 0;
  for (const positional of endpoint.positionals) {
    if (positional.variadic) {
      const values = positionalValues.slice(positionalIndex);
      if (values.length > 0) {
        raw.set(positional.parameterName, values);
      }
      positionalIndex = positionalValues.length;
    } else {
      const value = positionalValues[positionalIndex];
      if (value !== undefined) {
        raw.set(positional.parameterName, value);
        positionalIndex += 1;
      }
    }
  }
  if (positionalIndex < positionalValues.length) {
    return invalidCliInput(
      null,
      `Unexpected argument ${positionalValues[positionalIndex]}`,
    );
  }
  return { kind: "raw", raw: Object.fromEntries(raw) };
}

function storeOptionValue(
  raw: Map<string, unknown>,
  option: Extract<CliArgBinding, { readonly kind: "option" }>,
  shape: ValueShape,
  value: string,
): void {
  if (shape.kind !== VALUE_SHAPE_KIND.array) {
    raw.set(option.parameterName, value);
    return;
  }
  const nextValues =
    option.repeatMode === CLI_REPEAT_MODE.commaOrRepeat
      ? value.split(",")
      : [value];
  const current = raw.get(option.parameterName);
  raw.set(
    option.parameterName,
    Array.isArray(current) ? [...current, ...nextValues] : nextValues,
  );
}

function effectiveBooleanMode(
  option: Extract<CliArgBinding, { readonly kind: "option" }>,
  parameter: ParameterDefinition<string, JsonValue>,
): CliBooleanMode | null {
  if (parameter.codec.shape.kind !== VALUE_SHAPE_KIND.boolean) {
    return null;
  }
  return (
    option.booleanMode ??
    (parameter.requirement.defaultValue === undefined
      ? CLI_BOOLEAN_MODE.value
      : CLI_BOOLEAN_MODE.flag)
  );
}

function createHelpSurface(
  node: CompiledCliNode,
  root: boolean,
): CliHelpSurface {
  const entry = node.endpoint?.endpoint.entry;
  return {
    name: node.source.name,
    token: root ? null : node.segment.token,
    aliases: root ? [] : node.segment.aliases,
    description: node.source.description,
    executable: node.endpoint !== null,
    options: (node.endpoint?.options ?? []).map((row) => {
      const parameter = entry
        ? findParameter(entry.parameters, row.parameterName)
        : null;
      return {
        parameterName: row.parameterName,
        flags: row.flags,
        description: parameter?.description ?? "",
        required:
          parameter?.requirement.presence === PARAMETER_PRESENCE.required,
        booleanMode: parameter ? effectiveBooleanMode(row, parameter) : null,
        negated: row.negated ?? false,
        repeatMode:
          parameter?.codec.shape.kind === VALUE_SHAPE_KIND.array
            ? (row.repeatMode ?? CLI_REPEAT_MODE.repeat)
            : null,
      };
    }),
    positionals: (node.endpoint?.positionals ?? []).map((row) => {
      const parameter = entry
        ? findParameter(entry.parameters, row.parameterName)
        : null;
      return {
        parameterName: row.parameterName,
        valueName: row.valueName,
        description: parameter?.description ?? "",
        required:
          parameter?.requirement.presence === PARAMETER_PRESENCE.required,
        variadic: row.variadic,
      };
    }),
    children: node.children.map((child) => createHelpSurface(child, false)),
  };
}

function isCliSegment(value: unknown): value is CliSegment {
  if (
    !isObject(value) ||
    !("token" in value) ||
    typeof value.token !== "string"
  ) {
    return false;
  }
  if (!("aliases" in value)) {
    return false;
  }
  const aliases = value.aliases;
  return (
    Array.isArray(aliases) &&
    aliases.every((alias) => typeof alias === "string")
  );
}

function isCliEntryBinding(value: unknown): value is CliEntryBinding {
  if (
    !isObject(value) ||
    !("parameters" in value) ||
    !Array.isArray(value.parameters)
  ) {
    return false;
  }
  return value.parameters.every(isCliArgBinding);
}

function isCliArgBinding(value: unknown): value is CliArgBinding {
  if (
    !isObject(value) ||
    !("parameterName" in value) ||
    typeof value.parameterName !== "string" ||
    !("kind" in value)
  ) {
    return false;
  }
  if (value.kind === CLI_ARG_KIND.option) {
    return (
      "flags" in value &&
      Array.isArray(value.flags) &&
      value.flags.every((flag) => typeof flag === "string")
    );
  }
  return (
    value.kind === CLI_ARG_KIND.positional &&
    "valueName" in value &&
    typeof value.valueName === "string" &&
    "variadic" in value &&
    typeof value.variadic === "boolean"
  );
}

function isCliOptionBinding(
  value: CliArgBinding,
): value is Extract<CliArgBinding, { readonly kind: "option" }> {
  return value.kind === CLI_ARG_KIND.option;
}

function isCliPositionalBinding(
  value: CliArgBinding,
): value is Extract<CliArgBinding, { readonly kind: "positional" }> {
  return value.kind === CLI_ARG_KIND.positional;
}

function splitOptionToken(
  token: string,
): readonly [string, string | undefined] {
  const equalsIndex = token.indexOf("=");
  return equalsIndex < 0
    ? [token, undefined]
    : [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

function invalidCliInput(
  parameterName: string | null,
  issue: string,
): InvalidCliResult {
  return {
    kind: CLI_ROUTER_RESULT_KIND.invalidInput,
    parameterName,
    issues: [issue],
  };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
