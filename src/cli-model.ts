import type { JsonValue } from "@alpacaloop/core";
import type {
  ChannelSegmentOverride,
  EntryTreeEndpoint,
  TypedEntryChannelBinding,
} from "./model.js";
import type { CLI_BOOLEAN_MODE } from "./cli-values.js";
import {
  createChannelSegmentOverride,
  createEntryChannelBinding,
} from "./tree-internal.js";
import { CHANNEL } from "./values.js";

export const CLI_ARG_KIND = {
  option: "option",
  positional: "positional",
} as const;

export const CLI_REPEAT_MODE = {
  repeat: "repeat",
  commaOrRepeat: "comma_or_repeat",
} as const;

export const CLI_ROUTER_RESULT_KIND = {
  resolved: "resolved",
  unknownCommand: "unknown_command",
  incompleteCommand: "incomplete_command",
  invalidInput: "invalid_input",
  internalError: "internal_error",
} as const;

export type CliBooleanMode =
  (typeof CLI_BOOLEAN_MODE)[keyof typeof CLI_BOOLEAN_MODE];

export type CliRepeatMode =
  (typeof CLI_REPEAT_MODE)[keyof typeof CLI_REPEAT_MODE];

export type CliArgBinding<Name extends string = string> =
  | {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly parameterName: Name;
      readonly flags: readonly string[];
      readonly booleanMode?: CliBooleanMode;
      readonly negated?: true;
      readonly repeatMode?: typeof CLI_REPEAT_MODE.commaOrRepeat;
    }
  | {
      readonly kind: typeof CLI_ARG_KIND.positional;
      readonly parameterName: Name;
      readonly valueName: string;
      readonly variadic: boolean;
    };

export interface CliEntryBinding<Name extends string = string> {
  readonly parameters: readonly CliArgBinding<Name>[];
}

export interface CliSegment {
  readonly token: string;
  readonly aliases: readonly string[];
}

export function bindCliEntry<
  const Bindings extends readonly CliArgBinding[],
>(binding: {
  readonly parameters: Bindings;
}): TypedEntryChannelBinding<
  typeof CHANNEL.cli,
  Bindings[number]["parameterName"]
> {
  return createEntryChannelBinding(CHANNEL.cli, binding);
}

export function overrideCliSegment(
  segment: CliSegment,
): ChannelSegmentOverride {
  return createChannelSegmentOverride(CHANNEL.cli, segment);
}

export interface CliHelpOption {
  readonly parameterName: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly required: boolean;
  readonly booleanMode: CliBooleanMode | null;
  readonly negativeFlags: readonly string[];
  readonly repeatMode: CliRepeatMode | null;
  readonly defaultValue: JsonValue | undefined;
}

export interface CliHelpPositional {
  readonly parameterName: string;
  readonly valueName: string;
  readonly description: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly defaultValue: JsonValue | undefined;
}

export interface CliHelpSurface {
  readonly name: string;
  readonly token: string | null;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly executable: boolean;
  readonly options: readonly CliHelpOption[];
  readonly positionals: readonly CliHelpPositional[];
  readonly children: readonly CliHelpSurface[];
}

export type CliRouterResult =
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.resolved;
      readonly path: readonly string[];
      readonly endpoint: EntryTreeEndpoint;
      readonly projection: unknown;
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.unknownCommand;
      readonly path: readonly string[];
      readonly token: string;
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.incompleteCommand;
      readonly path: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.invalidInput;
      readonly path: readonly string[];
      readonly parameterName: string | null;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof CLI_ROUTER_RESULT_KIND.internalError;
      readonly path: readonly string[];
      readonly error: unknown;
    };

export type CliResolvedEndpointResult<Endpoint extends EntryTreeEndpoint> =
  Omit<
    Extract<
      CliRouterResult,
      { readonly kind: typeof CLI_ROUTER_RESULT_KIND.resolved }
    >,
    "endpoint" | "projection"
  > & {
    readonly endpoint: Endpoint;
    readonly projection: ReturnType<Endpoint["entry"]["project"]>;
  };

export function isCliResolvedEndpoint<const Endpoint extends EntryTreeEndpoint>(
  result: CliRouterResult,
  endpoint: Endpoint,
): result is CliResolvedEndpointResult<Endpoint> {
  return (
    result.kind === CLI_ROUTER_RESULT_KIND.resolved &&
    result.endpoint === endpoint
  );
}

export interface CliRouter {
  readonly help: CliHelpSurface;
  resolve(argv: readonly string[]): CliRouterResult;
}
