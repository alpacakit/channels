import { coerceCliArgvValue } from "./cli-coercion.js";
import {
  CLI_OPTION_ACTION_KIND,
  type CliOptionAction,
  type CompiledCliEndpoint,
  type CompiledCliOption,
  compileCliBinding,
} from "./cli-compiler.js";
import {
  createCliHelpSurface,
  validateCliCommandHelp,
  validateCliHelpExamples,
} from "./cli-help-projection.js";
import {
  CLI_ROUTER_RESULT_KIND,
  type CliGroupHelp,
  type CliEndpointLocation,
  type CliHelpSurface,
  type CliRouter,
  type CliRouterResult,
  type CliSegment,
  type CliValueCoercion,
} from "./cli-model.js";
import { isCliEntryBinding, isCliSegment } from "./cli-schema.js";
import {
  type CLI_OPTION_KIND,
  CLI_OPTION_VALUE_MODE,
  CLI_POSITIONAL_PLAN_KIND,
} from "./cli-values.js";
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

const CLI_ARGUMENT_SYNTAX = {
  inlineValueSeparator: "=",
  optionPrefix: "-",
  positionalSeparator: "--",
  repeatedValueSeparator: ",",
} as const;

const CLI_ARGUMENT_TOKEN_KIND = {
  option: "option",
  positionalSeparator: "positional_separator",
  value: "value",
} as const;

type CliArgumentTokenKind =
  (typeof CLI_ARGUMENT_TOKEN_KIND)[keyof typeof CLI_ARGUMENT_TOKEN_KIND];

const CLI_PARSE_RESULT_KIND = {
  parsed: "parsed",
  raw: "raw",
} as const;

const CLI_SEGMENT_NAME_KIND = {
  alias: "alias",
  token: "token",
} as const;

const CLI_TREE_VALIDATION_ISSUE = {
  subcommandHintWithoutChildren:
    "CLI subcommand hint requires at least one child command",
} as const;

const EMPTY_CLI_GROUP_HELP: CliGroupHelp = {
  subcommandHint: null,
  examples: [],
};

type CompiledCliNode = {
  readonly path: readonly string[];
  readonly segment: CliSegment;
  readonly endpoint: CompiledCliEndpoint | null;
  readonly childByToken: ReadonlyMap<string, CompiledCliNode>;
  readonly help: CliHelpSurface;
};

export function createCliRouter(tree: EntryTreeDefinition): CliRouter {
  const root = compileCliTree(tree);
  const endpointLocations = listCliEndpointLocations(root);
  return {
    help: root.help,
    endpoints: endpointLocations.map((location) => location.endpoint),
    endpointLocations,
    resolve: (argv) => resolveCli(root, argv),
  };
}

function listCliEndpointLocations(
  root: CompiledCliNode,
): readonly CliEndpointLocation[] {
  const locations: CliEndpointLocation[] = [];
  const visited = new Set<CompiledCliNode>();
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node)) {
      continue;
    }
    visited.add(node);
    if (node.endpoint !== null) {
      locations.push({
        endpoint: node.endpoint.endpoint,
        path: node.path.slice(1),
      });
    }
    pending.push(...node.childByToken.values());
  }
  return locations;
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

  const nodeQueue: {
    readonly node: EntryTreeNode;
    readonly parentPath: readonly string[];
    readonly root: boolean;
  }[] = [{ node: tree.root, parentPath: [], root: true }];
  for (const current of nodeQueue) {
    const segment = cliSegmentFor(
      current.node,
      current.parentPath,
      current.root,
      issues,
    );
    const path = current.root
      ? [current.node.name]
      : [...current.parentPath, segment.token];
    nodeRecords.set(current.node, {
      path,
      segment,
      endpoint: cliEndpointFor(current.node, path, issues),
    });
    nodeQueue.push(
      ...current.node.children.map((node) => ({
        node,
        parentPath: path,
        root: false,
      })),
    );
  }

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
    if (record.segment.help.subcommandHint !== null && children.length === 0) {
      issues.push(
        `${formatTreePath(record.path)}: ${CLI_TREE_VALIDATION_ISSUE.subcommandHintWithoutChildren}`,
      );
    }
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
      path: record.path,
      segment: record.segment,
      endpoint: record.endpoint,
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
  root: boolean,
  issues: string[],
): CliSegment {
  const override = node.segments.find((row) => row.channel === CHANNEL.cli);
  let segment: CliSegment;
  if (!override) {
    segment = { token: node.name, aliases: [], help: EMPTY_CLI_GROUP_HELP };
  } else if (!isCliSegment(override.segment)) {
    issues.push(`${formatTreePath(path)}: invalid CLI segment override`);
    segment = { token: node.name, aliases: [], help: EMPTY_CLI_GROUP_HELP };
  } else {
    segment = override.segment;
  }
  validateCliHelpExamples(segment.help.examples, formatTreePath(path), issues);
  if (!root) {
    validateCliCommandToken(
      segment.token,
      CLI_SEGMENT_NAME_KIND.token,
      path,
      issues,
    );
    for (const alias of segment.aliases) {
      validateCliCommandToken(alias, CLI_SEGMENT_NAME_KIND.alias, path, issues);
    }
  }
  return segment;
}

function validateCliCommandToken(
  token: string,
  kind: (typeof CLI_SEGMENT_NAME_KIND)[keyof typeof CLI_SEGMENT_NAME_KIND],
  path: readonly string[],
  issues: string[],
): void {
  if (token.length === 0) {
    issues.push(
      `${formatTreePath(path)}: CLI segment ${kind} must not be empty`,
    );
    return;
  }
  if (classifyCliArgumentToken(token) !== CLI_ARGUMENT_TOKEN_KIND.value) {
    issues.push(
      `${formatTreePath(path)}: CLI segment ${kind} ${JSON.stringify(token)} is unreachable`,
    );
  }
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
  const location = `${formatTreePath(path)}#${endpoint.entry.name}`;
  const compiled = compileCliBinding(
    endpoint,
    channelBinding.binding,
    location,
    issues,
  );
  validateCliCommandHelp(compiled, location, issues);
  return compiled;
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
          `${formatTreePath(path)}: CLI sibling token/alias collision ${JSON.stringify(token)} between ${owner} and ${child.help.name}`,
        );
      } else {
        tokens.set(token, child.help.name);
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
    if (token === undefined) {
      break;
    }
    if (classifyCliArgumentToken(token) !== CLI_ARGUMENT_TOKEN_KIND.value) {
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
    node.childByToken.size > 0 &&
    unmatchedToken !== undefined &&
    classifyCliArgumentToken(unmatchedToken) === CLI_ARGUMENT_TOKEN_KIND.value
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
  const compiledEndpoint = node.endpoint;
  const rawResult = parseCliArguments(compiledEndpoint, argv.slice(index));
  switch (rawResult.kind) {
    case CLI_ROUTER_RESULT_KIND.invalidInput:
    case CLI_ROUTER_RESULT_KIND.invalidParameter:
      return { ...rawResult, path: node.path };
    case CLI_PARSE_RESULT_KIND.raw:
      break;
  }
  const endpoint = compiledEndpoint.endpoint;
  const decoded = decodeEntryInput({
    entry: endpoint.entry,
    parameterNames: endpoint.entry.parameters.map(
      (parameter) => parameter.name,
    ),
    raw: rawResult.raw,
    coerce: (parameter, rawValue) =>
      coerceCliArgvValue(
        parameter.codec.shape,
        rawValue,
        cliCoercionFor(compiledEndpoint, parameter.name),
      ),
  });
  switch (decoded.kind) {
    case ENTRY_DECODE_RESULT_KIND.resolved:
      return {
        kind: CLI_ROUTER_RESULT_KIND.resolved,
        path: node.path,
        endpoint,
        projection: decoded.projection,
      };
    case ENTRY_DECODE_RESULT_KIND.invalidInput:
      return {
        kind: CLI_ROUTER_RESULT_KIND.invalidInput,
        path: node.path,
        issues: decoded.issues,
      };
    case ENTRY_DECODE_RESULT_KIND.invalidParameter:
      return {
        kind: CLI_ROUTER_RESULT_KIND.invalidParameter,
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

function cliCoercionFor(
  endpoint: CompiledCliEndpoint,
  parameterName: string,
): CliValueCoercion | null {
  return (
    [...endpoint.options, ...endpoint.positionals].find(
      (binding) => binding.parameter.name === parameterName,
    )?.coercion ?? null
  );
}

type InvalidCliResult =
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidInput;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidParameter;
      readonly parameterName: string;
      readonly issues: readonly string[];
    };

type RawCliResult =
  | {
      readonly kind: typeof CLI_PARSE_RESULT_KIND.raw;
      readonly raw: RawValueMap;
    }
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
    if (!positionalOnly) {
      switch (classifyCliArgumentToken(token)) {
        case CLI_ARGUMENT_TOKEN_KIND.positionalSeparator:
          positionalOnly = true;
          continue;
        case CLI_ARGUMENT_TOKEN_KIND.option: {
          const parsed = parseCliOption({ endpoint, argv, index, raw });
          switch (parsed.kind) {
            case CLI_ROUTER_RESULT_KIND.invalidInput:
            case CLI_ROUTER_RESULT_KIND.invalidParameter:
              return parsed;
            case CLI_PARSE_RESULT_KIND.parsed:
              if (parsed.consumedNext) {
                index += 1;
              }
          }
          continue;
        }
        case CLI_ARGUMENT_TOKEN_KIND.value:
          break;
      }
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
  | {
      readonly kind: typeof CLI_PARSE_RESULT_KIND.parsed;
      readonly consumedNext: boolean;
    }
  | InvalidCliResult {
  const token = input.argv[input.index] ?? "";
  const [flag, inlineValue] = splitOptionToken(token);
  const action = input.endpoint.optionByToken.get(flag);
  if (!action) {
    return invalidCliInput(`Unknown option ${flag}`);
  }
  if (action.kind === CLI_OPTION_ACTION_KIND.setBoolean) {
    return setCliBooleanValue(input.raw, action, flag, inlineValue);
  }
  const option = action.option;
  const value = inlineValue ?? input.argv[input.index + 1];
  if (value === undefined) {
    return invalidCliParameter(
      option.parameter.name,
      `${flag} requires a value`,
    );
  }
  storeOptionValue(input.raw, option, value);
  return {
    kind: CLI_PARSE_RESULT_KIND.parsed,
    consumedNext: inlineValue === undefined,
  };
}

function setCliBooleanValue(
  raw: Map<string, unknown>,
  action: Extract<
    CliOptionAction,
    { readonly kind: typeof CLI_OPTION_ACTION_KIND.setBoolean }
  >,
  flag: string,
  inlineValue: string | undefined,
):
  | {
      readonly kind: typeof CLI_PARSE_RESULT_KIND.parsed;
      readonly consumedNext: false;
    }
  | InvalidCliResult {
  if (inlineValue !== undefined) {
    return invalidCliParameter(
      action.parameterName,
      `${flag} does not take a value`,
    );
  }
  raw.set(action.parameterName, action.value);
  return { kind: CLI_PARSE_RESULT_KIND.parsed, consumedNext: false };
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
      `Unexpected argument ${positionalValues[positionalIndex]}`,
    );
  }
  return { kind: CLI_PARSE_RESULT_KIND.raw, raw: Object.fromEntries(raw) };
}

function storeOptionValue(
  raw: Map<string, unknown>,
  option: Extract<
    CompiledCliOption,
    { readonly kind: typeof CLI_OPTION_KIND.value }
  >,
  value: string,
): void {
  switch (option.valueMode) {
    case CLI_OPTION_VALUE_MODE.replace:
      raw.set(option.parameter.name, value);
      return;
    case CLI_OPTION_VALUE_MODE.repeat:
      appendOptionValues(raw, option.parameter.name, [value]);
      return;
    case CLI_OPTION_VALUE_MODE.commaOrRepeat:
      appendOptionValues(
        raw,
        option.parameter.name,
        value.split(CLI_ARGUMENT_SYNTAX.repeatedValueSeparator),
      );
      return;
  }
}

function appendOptionValues(
  raw: Map<string, unknown>,
  parameterName: string,
  values: readonly string[],
): void {
  const current = raw.get(parameterName);
  raw.set(
    parameterName,
    Array.isArray(current) ? [...current, ...values] : values,
  );
}

function splitOptionToken(
  token: string,
): readonly [string, string | undefined] {
  const equalsIndex = token.indexOf(CLI_ARGUMENT_SYNTAX.inlineValueSeparator);
  return equalsIndex < 0
    ? [token, undefined]
    : [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

function classifyCliArgumentToken(token: string): CliArgumentTokenKind {
  if (token === CLI_ARGUMENT_SYNTAX.positionalSeparator) {
    return CLI_ARGUMENT_TOKEN_KIND.positionalSeparator;
  }
  return token.startsWith(CLI_ARGUMENT_SYNTAX.optionPrefix)
    ? CLI_ARGUMENT_TOKEN_KIND.option
    : CLI_ARGUMENT_TOKEN_KIND.value;
}

function invalidCliInput(issue: string): InvalidCliResult {
  return {
    kind: CLI_ROUTER_RESULT_KIND.invalidInput,
    issues: [issue],
  };
}

function invalidCliParameter(
  parameterName: string,
  issue: string,
): InvalidCliResult {
  return {
    kind: CLI_ROUTER_RESULT_KIND.invalidParameter,
    parameterName,
    issues: [issue],
  };
}
