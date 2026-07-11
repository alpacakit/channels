import type { JsonValue } from "@alpacaloop/core";
import type {
  ChannelSegmentOverride,
  EntryChannelBinding,
  EntryTreeEndpoint,
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

export type CliLongOptionFlag = `--${string}`;
export type CliOptionFlag = `-${string}`;

export type CliArgBinding<Name extends string = string> =
  | {
      readonly kind: typeof CLI_ARG_KIND.option;
      readonly parameterName: Name;
      /** Defaults to `--<kebab-case parameter name>` when omitted. */
      readonly flags?: readonly CliOptionFlag[];
      readonly booleanMode?: CliBooleanMode;
      readonly negated?: true;
      readonly repeatMode?: typeof CLI_REPEAT_MODE.commaOrRepeat;
    }
  | {
      readonly kind: typeof CLI_ARG_KIND.positional;
      readonly parameterName: Name;
      /** Defaults to the upper snake-cased parameter name when omitted. */
      readonly valueName?: string;
      /** Defaults to `false` when omitted. */
      readonly variadic?: boolean;
    };

export type CliEntryBinding<Name extends string = string> = {
  readonly parameters: readonly CliArgBinding<Name>[];
};

export type CliSegment = {
  readonly token: string;
  readonly aliases: readonly string[];
};

export function bindCliEntry<
  const Bindings extends readonly CliArgBinding[],
>(binding: {
  readonly parameters: Bindings;
}): EntryChannelBinding<typeof CHANNEL.cli, Bindings[number]["parameterName"]> {
  return createEntryChannelBinding(CHANNEL.cli, binding);
}

export function overrideCliSegment(
  segment: CliSegment,
): ChannelSegmentOverride {
  return createChannelSegmentOverride(CHANNEL.cli, segment);
}

export type CliHelpOption = {
  readonly parameterName: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly required: boolean;
  readonly booleanMode: CliBooleanMode | null;
  readonly negativeFlags: readonly string[];
  readonly repeatMode: CliRepeatMode | null;
  readonly defaultValue: JsonValue | undefined;
};

export type CliHelpPositional = {
  readonly parameterName: string;
  readonly valueName: string;
  readonly description: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly defaultValue: JsonValue | undefined;
};

export type CliHelpSurface = {
  readonly name: string;
  readonly token: string | null;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly executable: boolean;
  readonly options: readonly CliHelpOption[];
  readonly positionals: readonly CliHelpPositional[];
  readonly children: readonly CliHelpSurface[];
};

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
