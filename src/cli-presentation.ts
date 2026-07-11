import {
  CLI_REPEAT_MODE,
  CLI_ROUTER_RESULT_KIND,
  type CliHelpOption,
  type CliHelpSurface,
  type CliRepeatMode,
  type CliRouterResult,
} from "./cli-model.js";

export type RenderCliHelpOptions = {
  readonly programName?: string;
};

export function findCliHelpSurface(
  root: CliHelpSurface,
  commandPath: readonly string[],
): CliHelpSurface | null {
  let current = root;
  for (const token of commandPath) {
    const child = current.children.find(
      (candidate) =>
        candidate.token === token || candidate.aliases.includes(token),
    );
    if (!child) {
      return null;
    }
    current = child;
  }
  return current;
}

export function renderCliHelp(
  surface: CliHelpSurface,
  options: RenderCliHelpOptions = {},
): string {
  const programName = options.programName ?? surface.token ?? surface.name;
  const rendered = [renderCliHelpSurface(surface, programName)];
  const pending = surface.children.map((child) => ({
    surface: child,
    commandPath: `${programName} ${child.token ?? child.name}`,
  }));
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    if (current.surface.executable) {
      rendered.push(renderCliHelpSurface(current.surface, current.commandPath));
    }
    pending.push(
      ...current.surface.children.map((child) => ({
        surface: child,
        commandPath: `${current.commandPath} ${child.token ?? child.name}`,
      })),
    );
  }
  return `Command reference\n\n${rendered.join("\n\n")}\n`;
}

function renderCliHelpSurface(
  surface: CliHelpSurface,
  programName: string,
): string {
  const usage = [
    programName,
    ...(surface.options.length > 0 ? ["[options]"] : []),
    ...surface.positionals.map((positional) =>
      positional.required
        ? `<${positional.valueName}${positional.variadic ? "..." : ""}>`
        : `[${positional.valueName}${positional.variadic ? "..." : ""}]`,
    ),
    ...(surface.children.length > 0 ? ["<command>"] : []),
  ].join(" ");
  const sections: string[][] = [[`Usage: ${usage}`, "", surface.description]];
  if (surface.children.length > 0) {
    sections.push([
      "Commands:",
      ...surface.children.map((child) => {
        const names = [child.token ?? child.name, ...child.aliases].join(", ");
        return `  ${names}\t${child.description}`;
      }),
    ]);
  }
  if (surface.positionals.length > 0) {
    sections.push([
      "Arguments:",
      ...surface.positionals.map(
        (positional) =>
          `  ${positional.valueName}\t${formatHelpDescription(positional)}`,
      ),
    ]);
  }
  if (surface.options.length > 0) {
    sections.push([
      "Options:",
      ...surface.options.map(
        (option) =>
          `  ${formatOptionNames(option)}\t${formatHelpDescription(option)}`,
      ),
    ]);
  }
  return sections.map((section) => section.join("\n")).join("\n\n");
}

export function formatCliRouterError(
  result: Extract<
    CliRouterResult,
    {
      readonly kind:
        | typeof CLI_ROUTER_RESULT_KIND.unknownCommand
        | typeof CLI_ROUTER_RESULT_KIND.incompleteCommand
        | typeof CLI_ROUTER_RESULT_KIND.invalidInput;
    }
  >,
): string {
  switch (result.kind) {
    case CLI_ROUTER_RESULT_KIND.unknownCommand:
      return `Unknown command: ${[...result.path, result.token].join(" ")}.`;
    case CLI_ROUTER_RESULT_KIND.incompleteCommand:
      return `Incomplete command: ${result.path.join(" ")}.`;
    case CLI_ROUTER_RESULT_KIND.invalidInput: {
      const label =
        result.parameterName === null
          ? "Invalid input"
          : `Invalid ${result.parameterName}`;
      return `${label}: ${result.issues.join("; ")}`;
    }
  }
}

function formatOptionNames(option: CliHelpOption): string {
  const suffix = option.valueName === null ? "" : ` <${option.valueName}>`;
  return `${[...option.flags, ...option.negativeFlags].join(", ")}${suffix}`;
}

function formatHelpDescription(input: {
  readonly description: string;
  readonly required: boolean;
  readonly defaultValue: unknown;
  readonly repeatMode?: CliRepeatMode | null;
}): string {
  const details = [input.required ? "required" : "optional"];
  if (input.repeatMode === CLI_REPEAT_MODE.repeat) {
    details.push("repeatable");
  } else if (input.repeatMode === CLI_REPEAT_MODE.commaOrRepeat) {
    details.push("comma-separated or repeatable");
  }
  if (input.defaultValue !== undefined) {
    details.push(`default: ${JSON.stringify(input.defaultValue)}`);
  }
  return `${input.description} (${details.join(", ")})`;
}
