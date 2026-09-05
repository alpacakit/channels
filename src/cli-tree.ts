import { coerceCliArgvValue } from "./cli-coercion.js";
import {
  type CompiledCliEndpoint,
  compileCliBinding,
  projectCliParameters,
} from "./cli-compiler.js";
import {
  createCliHelpSurface,
  validateCliCommandHelp,
  validateCliHelpExamples,
} from "./cli-help-projection.js";
import {
  CLI_ARG_KIND,
  type CliArgBinding,
  type CliCommandNode,
  type CliCommandTree,
  type CliEntryBinding,
  type CliGroupHelp,
  type CliHelpSurface,
  type CliRegistrationCollection,
  type CliSegment,
} from "./cli-model.js";
import { compileInputPlan } from "./input-compiler.js";
import type {
  EntryChannelBinding,
  EntryTreeNode,
  ErasedParameterDefinition,
  RawValueMap,
} from "./model.js";
import { ownedArray, ownedRecord } from "./owned.js";
import {
  type ContextFor,
  type EndpointForChannel,
  type EndpointsOfSource,
  type EntryTreeSource,
  type OutputFor,
  packRegistrationCollection,
} from "./registration.js";
import {
  EntryTreeDefinitionError,
  findChannelBinding,
  formatTreePath,
  isEntryTreeDefinition,
  validateEntryTreeStructure,
} from "./schema.js";
import { isChannelPayload, PAYLOAD_KIND } from "./tree-internal.js";
import { CHANNEL } from "./values.js";

const EMPTY_CLI_GROUP_HELP: CliGroupHelp = ownedRecord({
  subcommandHint: null,
  examples: ownedArray([]),
});

type CliEndpointFor<Source extends EntryTreeSource> = EndpointForChannel<
  EndpointsOfSource<Source>,
  typeof CHANNEL.cli
>;

export function collectCliCommands<const Source extends EntryTreeSource>(
  source: Source,
): CliCommandTree<
  ContextFor<CliEndpointFor<Source>>,
  OutputFor<CliEndpointFor<Source>>
> {
  const structuralIssues = validateEntryTreeStructure(source);
  if (structuralIssues.length > 0) {
    throw new EntryTreeDefinitionError(structuralIssues);
  }
  const issues: string[] = [];
  const root = isEntryTreeDefinition(source)
    ? compileTreeRoot(source.root, issues)
    : compileVirtualRoot(source, issues);
  if (issues.length > 0) {
    throw new EntryTreeDefinitionError(issues);
  }
  return ownedRecord({ root }) as CliCommandTree<
    ContextFor<CliEndpointFor<Source>>,
    OutputFor<CliEndpointFor<Source>>
  >;
}

function compileTreeRoot(
  root: EntryTreeNode,
  issues: string[],
): CliCommandNode<unknown, unknown> {
  const segment = cliSegmentFor(root, [], issues);
  return compileNode(root, segment, [], true, issues);
}

function compileVirtualRoot(
  node: EntryTreeNode,
  issues: string[],
): CliCommandNode<unknown, unknown> {
  const segment = cliSegmentFor(node, [node.name], issues);
  const child = compileNode(node, segment, [segment.token], false, issues);
  const help = emptyVirtualRootHelp(child.help);
  return ownedRecord({
    token: "",
    path: ownedArray([]),
    description: "",
    documentation: ownedRecord({
      remarks: ownedArray([]),
      relatedDocs: ownedArray([]),
    }),
    help,
    commands: packRegistrationCollection<
      CliRegistrationCollection<unknown, unknown>
    >([]),
    children: ownedArray([child]),
  });
}

function compileNode(
  node: EntryTreeNode,
  segment: CliSegment,
  path: readonly string[],
  root: boolean,
  issues: string[],
): CliCommandNode<unknown, unknown> {
  const token = segment.token;
  validateCliToken(token, path, issues);
  const compiledEndpoint = cliEndpointFor(node, path, issues);
  const children = node.children.map((child) => {
    const childSegment = cliSegmentFor(child, [...path, child.name], issues);
    return compileNode(
      child,
      childSegment,
      [...path, childSegment.token],
      false,
      issues,
    );
  });
  validateChildTokens(path, children, issues);
  if (segment.help.subcommandHint !== null && children.length === 0) {
    issues.push(
      `${formatTreePath(path)}: CLI subcommand hint requires children`,
    );
  }
  const help = createCliHelpSurface({
    node,
    segment,
    endpoint: compiledEndpoint,
    childHelp: children.map((child) => child.help),
    root,
  });
  const registrations =
    compiledEndpoint === null
      ? []
      : [createCliRegistration(compiledEndpoint, path)];
  return ownedRecord({
    token,
    path: ownedArray(path),
    description: node.description,
    documentation: node.documentation,
    help,
    commands:
      packRegistrationCollection<CliRegistrationCollection<unknown, unknown>>(
        registrations,
      ),
    children: ownedArray(children),
  });
}

function cliEndpointFor(
  node: EntryTreeNode,
  path: readonly string[],
  issues: string[],
): CompiledCliEndpoint | null {
  const endpoints = [
    ...new Set(
      node.endpoints.filter((endpoint) =>
        endpoint.channels.some((binding) => binding.channel === CHANNEL.cli),
      ),
    ),
  ];
  const location = formatTreePath(path);
  if (endpoints.length > 1) {
    issues.push(`${location}: different CLI endpoints occupy the same path`);
  }
  const endpoint = endpoints[0];
  if (endpoint === undefined) {
    return null;
  }
  const channelBinding = findChannelBinding(endpoint, CHANNEL.cli);
  if (channelBinding === null || !isCliChannelBinding(channelBinding)) {
    issues.push(`${location}: invalid CLI endpoint binding`);
    return null;
  }
  const compiled = compileCliBinding(
    endpoint,
    channelBinding.binding,
    `${location}#${endpoint.entry.name}`,
    issues,
  );
  validateCliCommandHelp(compiled, location, issues);
  return compiled;
}

function createCliRegistration(
  compiled: CompiledCliEndpoint,
  path: readonly string[],
) {
  const input = compileInputPlan({
    entry: compiled.endpoint.entry,
    bindings: compiled.parameterBindings,
  });
  const rows = new Map(
    compiled.binding.parameters.map((row) => [row.parameterName, row]),
  );
  const parseOptions = (raw: RawValueMap): unknown =>
    input.parseCoerced(raw, (parameter, value) => {
      const row = rows.get(parameter.name);
      if (row === undefined) {
        throw new Error(`Missing compiled CLI binding for ${parameter.name}`);
      }
      return coerceCliValue(parameter, row, value);
    });
  const channelBinding = findChannelBinding(compiled.endpoint, CHANNEL.cli);
  if (channelBinding === null) {
    throw new Error("Compiled CLI endpoint lost its binding");
  }
  return ownedRecord({
    endpoint: compiled.endpoint,
    entry: compiled.endpoint.entry,
    binding: channelBinding,
    path: ownedArray(path),
    parameters: projectCliParameters(compiled),
    input: ownedRecord({
      schema: input.schema,
      parse: input.parse,
      project: input.project,
      parseOptions,
    }),
    handler: compiled.endpoint.handler,
  });
}

function coerceCliValue(
  parameter: ErasedParameterDefinition,
  row: CliArgBinding,
  raw: unknown,
): unknown {
  const expanded =
    row.kind === CLI_ARG_KIND.option && row.repeatable && row.coercion === null
      ? expandCommaSeparated(raw)
      : raw;
  return coerceCliArgvValue(
    parameter.name,
    parameter.codec.shape,
    expanded,
    row.coercion,
  );
}

function expandCommaSeparated(raw: unknown): unknown {
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) =>
    typeof value === "string" ? value.split(",") : [value],
  );
}

function cliSegmentFor(
  node: EntryTreeNode,
  path: readonly string[],
  issues: string[],
): CliSegment {
  const override = node.segments.find((row) => row.channel === CHANNEL.cli);
  if (override === undefined) {
    return ownedRecord({ token: node.name, help: EMPTY_CLI_GROUP_HELP });
  }
  if (!isCliSegment(override.segment)) {
    issues.push(`${formatTreePath(path)}: invalid CLI segment override`);
    return ownedRecord({ token: node.name, help: EMPTY_CLI_GROUP_HELP });
  }
  validateCliHelpExamples(
    override.segment.help.examples,
    formatTreePath(path),
    issues,
  );
  return override.segment;
}

function validateCliToken(
  token: string,
  path: readonly string[],
  issues: string[],
): void {
  if (token.length === 0 || /\s/u.test(token)) {
    issues.push(
      `${formatTreePath(path)}: CLI token must be non-empty and contain no whitespace`,
    );
  }
}

function validateChildTokens(
  path: readonly string[],
  children: readonly CliCommandNode<unknown, unknown>[],
  issues: string[],
): void {
  const owners = new Map<string, string>();
  for (const child of children) {
    const owner = owners.get(child.token);
    if (owner !== undefined) {
      issues.push(
        `${formatTreePath(path)}: CLI child token ${JSON.stringify(child.token)} collides between ${owner} and ${child.description}`,
      );
    } else {
      owners.set(child.token, child.description);
    }
  }
}

function emptyVirtualRootHelp(child: CliHelpSurface): CliHelpSurface {
  return ownedRecord({
    name: "",
    token: null,
    description: "",
    optionGroups: ownedArray([]),
    positionals: ownedArray([]),
    children: ownedArray([child]),
    remarks: ownedArray([]),
    relatedDocs: ownedArray([]),
    usages: ownedArray(["<command>"]),
    examples: ownedArray([]),
    subcommandHint: null,
  });
}

function isCliEntryBinding(value: unknown): value is CliEntryBinding {
  return isChannelPayload(PAYLOAD_KIND.cliBinding, value);
}

function isCliChannelBinding(
  binding: EntryChannelBinding,
): binding is EntryChannelBinding<typeof CHANNEL.cli, CliEntryBinding> {
  return binding.channel === CHANNEL.cli && isCliEntryBinding(binding.binding);
}

function isCliSegment(value: unknown): value is CliSegment {
  return isChannelPayload(PAYLOAD_KIND.cliSegment, value);
}
