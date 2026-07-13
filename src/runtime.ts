import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacaloop/core";
import { findParameter } from "./internal.js";
import type {
  ErasedEntryDefinition,
  ErasedParameterDefinition,
  ParameterSet,
  ParameterValues,
  RawValueMap,
} from "./model.js";
import {
  ENTRY_DECODE_RESULT_KIND,
  ENTRY_INPUT_TARGET_KIND,
  PARAMETER_REQUIREMENT_KIND,
} from "./values.js";

export type EntryInputTarget =
  | { readonly kind: typeof ENTRY_INPUT_TARGET_KIND.entry }
  | {
      readonly kind: typeof ENTRY_INPUT_TARGET_KIND.parameter;
      readonly parameterName: string;
    };

const ENTRY_INPUT_TARGET = {
  kind: ENTRY_INPUT_TARGET_KIND.entry,
} as const satisfies EntryInputTarget;

export class EntryInputError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly target: EntryInputTarget = ENTRY_INPUT_TARGET,
  ) {
    super(issues.join("; "));
    this.name = EntryInputError.name;
  }
}

export type EntryDecodeResult<Projection> =
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.resolved;
      readonly projection: Projection;
    }
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.invalidInput;
      readonly issues: readonly string[];
    }
  | InvalidParameterDecodeResult
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.internalError;
      readonly error: unknown;
    };

type InvalidParameterDecodeResult = {
  readonly kind: typeof ENTRY_DECODE_RESULT_KIND.invalidParameter;
  readonly parameterName: string;
  readonly issues: readonly string[];
};

export type ParameterDecodeResult<Parameters extends ParameterSet> =
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.resolved;
      readonly values: ParameterValues<Parameters>;
    }
  | InvalidParameterDecodeResult;

export type RawValueCoercer = (
  parameter: ErasedParameterDefinition,
  rawValue: unknown,
) => unknown;

const PARAMETER_CANDIDATE_KIND = {
  omitted: "omitted",
  raw: "raw",
  default: "default",
  invalid: "invalid",
} as const;

type ParameterCandidate =
  | { readonly kind: typeof PARAMETER_CANDIDATE_KIND.omitted }
  | {
      readonly kind: typeof PARAMETER_CANDIDATE_KIND.raw;
      readonly value: unknown;
    }
  | {
      readonly kind: typeof PARAMETER_CANDIDATE_KIND.default;
      readonly value: JsonValue;
    }
  | {
      readonly kind: typeof PARAMETER_CANDIDATE_KIND.invalid;
      readonly issues: readonly string[];
    };

export function decodeParameterValues<
  const Parameters extends ParameterSet,
>(input: {
  readonly parameters: Parameters;
  readonly parameterNames: readonly string[];
  readonly raw: RawValueMap;
  readonly coerce?: RawValueCoercer;
}): ParameterDecodeResult<Parameters> {
  const output = new Map<string, JsonValue>();
  const boundParameterNames = new Set(input.parameterNames);
  for (const parameterName of input.parameterNames) {
    const parameter = findParameter(input.parameters, parameterName);
    if (parameter === null) {
      return invalidParameter(parameterName, [
        `Unknown parameter binding: ${parameterName}`,
      ]);
    }
  }
  for (const parameter of input.parameters) {
    const candidate = resolveParameterCandidate(
      parameter,
      boundParameterNames.has(parameter.name)
        ? input.raw[parameter.name]
        : undefined,
    );
    if (candidate.kind === PARAMETER_CANDIDATE_KIND.omitted) {
      continue;
    }
    if (candidate.kind === PARAMETER_CANDIDATE_KIND.invalid) {
      return invalidParameter(parameter.name, candidate.issues);
    }

    let value: unknown;
    try {
      value =
        candidate.kind === PARAMETER_CANDIDATE_KIND.raw && input.coerce
          ? input.coerce(parameter, candidate.value)
          : candidate.value;
    } catch (error) {
      return invalidParameter(parameter.name, [errorMessage(error)]);
    }
    try {
      const decoded = parameter.codec.decode(value);
      if (decoded.kind === CODEC_DECODE_RESULT_KIND.invalid) {
        return invalidParameter(parameter.name, decoded.issues);
      }
      output.set(parameter.name, decoded.value);
    } catch (error) {
      return invalidParameter(parameter.name, [errorMessage(error)]);
    }
  }
  return {
    kind: ENTRY_DECODE_RESULT_KIND.resolved,
    values: Object.fromEntries(output) as ParameterValues<Parameters>,
  };
}

function resolveParameterCandidate(
  parameter: ErasedParameterDefinition,
  rawValue: unknown,
): ParameterCandidate {
  if (rawValue !== undefined) {
    return { kind: PARAMETER_CANDIDATE_KIND.raw, value: rawValue };
  }
  switch (parameter.requirement.kind) {
    case PARAMETER_REQUIREMENT_KIND.required:
      return {
        kind: PARAMETER_CANDIDATE_KIND.invalid,
        issues: [`Missing required parameter ${parameter.name}`],
      };
    case PARAMETER_REQUIREMENT_KIND.optional:
      return { kind: PARAMETER_CANDIDATE_KIND.omitted };
    case PARAMETER_REQUIREMENT_KIND.optionalWithDefault:
      return {
        kind: PARAMETER_CANDIDATE_KIND.default,
        value: parameter.requirement.defaultValue,
      };
  }
}

export function decodeEntryInput<
  const Entry extends ErasedEntryDefinition,
>(input: {
  readonly entry: Entry;
  readonly parameterNames: readonly string[];
  readonly raw: RawValueMap;
  readonly coerce?: RawValueCoercer;
}): EntryDecodeResult<ReturnType<Entry["project"]>> {
  const decoded = decodeParameterValues<Entry["parameters"]>({
    parameters: input.entry.parameters,
    parameterNames: input.parameterNames,
    raw: input.raw,
    ...(input.coerce ? { coerce: input.coerce } : {}),
  });
  if (decoded.kind === ENTRY_DECODE_RESULT_KIND.invalidParameter) {
    return decoded;
  }
  const project = input.entry.project as unknown as (input: {
    readonly values: ParameterValues<Entry["parameters"]>;
  }) => ReturnType<Entry["project"]>;
  try {
    return {
      kind: ENTRY_DECODE_RESULT_KIND.resolved,
      projection: project({
        values: decoded.values,
      }),
    };
  } catch (error) {
    if (error instanceof EntryInputError) {
      const target = error.target;
      switch (target.kind) {
        case ENTRY_INPUT_TARGET_KIND.entry:
          return {
            kind: ENTRY_DECODE_RESULT_KIND.invalidInput,
            issues: error.issues,
          };
        case ENTRY_INPUT_TARGET_KIND.parameter:
          if (
            !input.entry.parameters.some(
              (parameter) => parameter.name === target.parameterName,
            )
          ) {
            return { kind: ENTRY_DECODE_RESULT_KIND.internalError, error };
          }
          return {
            kind: ENTRY_DECODE_RESULT_KIND.invalidParameter,
            parameterName: target.parameterName,
            issues: error.issues,
          };
      }
    }
    return { kind: ENTRY_DECODE_RESULT_KIND.internalError, error };
  }
}

function invalidParameter(
  parameterName: string,
  issues: readonly string[],
): InvalidParameterDecodeResult {
  return {
    kind: ENTRY_DECODE_RESULT_KIND.invalidParameter,
    parameterName,
    issues,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
