import { coerceCliArgvValue } from "./cli-coercion.js";
import {
  CLI_OPTION_ACTION_KIND,
  CLI_OPTION_VALUE_MODE,
  CLI_POSITIONAL_PLAN_KIND,
  type CliOptionAction,
  type CompiledCliEndpoint,
  type CompiledCliOption,
  compileCliBinding,
  createCliHelpSurface,
} from "./cli-compiler.js";
import {
  CLI_ARG_KIND,
  CLI_ROUTER_RESULT_KIND,
  type CliArgBinding,
  type CliEntryBinding,
  type CliHelpSurface,
  type CliRouter,
  type CliRouterResult,
  type CliSegment,
} from "./cli-model.js";
import type {
  EntryTreeDefinition,
  EntryTreeNode,
  RawValueMap,
} from "./model.js";
import { decodeEntryInput } from "./runtime.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  formatTreePath,
  validateEntryTreeStructure,
  visitEntryTree,
} from "./schema.js";
import { CHANNEL, ENTRY_DECODE_RESULT_KIND } from "./values.js";

const CLI_POSITIONAL_SEPARATOR = "--";

interface CompiledCliNode {
  readonly source: EntryTreeNode;
  readonly path: readonly string[];
  readonly segment: CliSegment;
  readonly endpoint: CompiledCliEndpoint | null;
  readonly children: readonly CompiledCliNode[];
  readonly childByToken: ReadonlyMap<string, CompiledCliNode>;
  readonly help: CliHelpSurface;
}

export function createCliRouter(tree: EntryTreeDefinition): CliRouter {
  const root = compileCliTree(tree);
  return {
    help: root.help,
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
    const compiledNode: CompiledCliNode = {
      source: node,
      path: record.path,
      segment: record.segment,
      endpoint: record.endpoint,
      children,
      childByToken,
      help: createCliHelpSurface({
        node,
        segment: record.segment,
        endpoint: record.endpoint,
        childHelp: children.map((child) => child.help),
        root: node === tree.root,
      }),
    };
    publicNodes.set(node, compiledNode);
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
  return compileCliBinding(endpoint, channelBinding.binding, path, issues);
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
    parameterNames: node.endpoint.parameterNames,
    raw: rawResult.raw,
    coerce: (parameter, rawValue) =>
      coerceCliArgvValue(parameter.codec.shape, rawValue),
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
      const parsed = parseCliOption({ endpoint, argv, index, raw });
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

function parseCliOption(input: {
  readonly endpoint: CompiledCliEndpoint;
  readonly argv: readonly string[];
  readonly index: number;
  readonly raw: Map<string, unknown>;
}):
  | { readonly kind: "parsed"; readonly consumedNext: boolean }
  | InvalidCliResult {
  const token = input.argv[input.index] ?? "";
  const [flag, inlineValue] = splitOptionToken(token);
  const action = input.endpoint.optionByToken.get(flag);
  if (!action) {
    return invalidCliInput(null, `Unknown option ${flag}`);
  }
  if (action.kind === CLI_OPTION_ACTION_KIND.setBoolean) {
    return setCliBooleanValue(input.raw, action, flag, inlineValue);
  }
  const option = action.option;
  const value = inlineValue ?? input.argv[input.index + 1];
  if (value === undefined) {
    return invalidCliInput(option.parameter.name, `${flag} requires a value`);
  }
  storeOptionValue(input.raw, option, value);
  return { kind: "parsed", consumedNext: inlineValue === undefined };
}

function setCliBooleanValue(
  raw: Map<string, unknown>,
  action: Extract<CliOptionAction, { readonly kind: "set_boolean" }>,
  flag: string,
  inlineValue: string | undefined,
):
  | { readonly kind: "parsed"; readonly consumedNext: false }
  | InvalidCliResult {
  if (inlineValue !== undefined) {
    return invalidCliInput(
      action.parameterName,
      `${flag} does not take a value`,
    );
  }
  raw.set(action.parameterName, action.value);
  return { kind: "parsed", consumedNext: false };
}

function bindCliPositionals(
  endpoint: CompiledCliEndpoint,
  positionalValues: readonly string[],
  raw: Map<string, unknown>,
): RawCliResult {
  let positionalIndex = 0;
  for (const positional of endpoint.positionals) {
    if (positional.kind === CLI_POSITIONAL_PLAN_KIND.rest) {
      const values = positionalValues.slice(positionalIndex);
      if (values.length > 0) {
        raw.set(positional.parameter.name, values);
      }
      positionalIndex = positionalValues.length;
    } else {
      const value = positionalValues[positionalIndex];
      if (value !== undefined) {
        raw.set(positional.parameter.name, value);
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
  option: Extract<CompiledCliOption, { readonly kind: "value" }>,
  value: string,
): void {
  if (option.valueMode === CLI_OPTION_VALUE_MODE.replace) {
    raw.set(option.parameter.name, value);
    return;
  }
  const nextValues =
    option.valueMode === CLI_OPTION_VALUE_MODE.commaOrRepeat
      ? value.split(",")
      : [value];
  const current = raw.get(option.parameter.name);
  raw.set(
    option.parameter.name,
    Array.isArray(current) ? [...current, ...nextValues] : nextValues,
  );
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
