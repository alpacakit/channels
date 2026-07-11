import { CODEC_DECODE_RESULT_KIND, type JsonValue } from "@alpacaloop/core";
import { findParameter } from "./internal.js";
import type {
  EntryDefinition,
  ParameterDefinition,
  ParameterSet,
  ParameterValues,
  RawValueMap,
} from "./model.js";
import { ENTRY_DECODE_RESULT_KIND, PARAMETER_PRESENCE } from "./values.js";

export class EntryInputError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join("; "));
    this.name = EntryInputError.name;
  }
}

export type EntryDecodeResult<Parameters extends ParameterSet, Projection> =
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.resolved;
      readonly values: ParameterValues<Parameters>;
      readonly projection: Projection;
    }
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.invalidInput;
      readonly parameterName: string | null;
      readonly issues: readonly string[];
    }
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.internalError;
      readonly error: unknown;
    };

export type ParameterDecodeResult<Parameters extends ParameterSet> =
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.resolved;
      readonly values: ParameterValues<Parameters>;
    }
  | {
      readonly kind: typeof ENTRY_DECODE_RESULT_KIND.invalidInput;
      readonly parameterName: string | null;
      readonly issues: readonly string[];
    };

export type RawValueCoercer = (
  parameter: ParameterDefinition<string, JsonValue>,
  rawValue: unknown,
) => unknown;

export function decodeParameterValues<
  const Parameters extends ParameterSet,
>(input: {
  readonly parameters: Parameters;
  readonly parameterNames: readonly string[];
  readonly raw: RawValueMap;
  readonly coerce?: RawValueCoercer;
}): ParameterDecodeResult<Parameters> {
  const output = new Map<string, JsonValue>();
  for (const parameterName of input.parameterNames) {
    const parameter = findParameter(input.parameters, parameterName);
    if (parameter === null) {
      return invalidParameter(parameterName, [
        `Unknown parameter binding: ${parameterName}`,
      ]);
    }
    const rawValue = input.raw[parameter.name];
    if (rawValue === undefined) {
      if (parameter.requirement.defaultValue !== undefined) {
        output.set(parameter.name, parameter.requirement.defaultValue);
        continue;
      }
      if (parameter.requirement.presence === PARAMETER_PRESENCE.required) {
        return invalidParameter(parameter.name, [
          `Missing required parameter ${parameter.name}`,
        ]);
      }
      continue;
    }

    let value: unknown;
    try {
      value = input.coerce ? input.coerce(parameter, rawValue) : rawValue;
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

export function decodeEntryInput<
  const Name extends string,
  const Parameters extends ParameterSet,
  Projection,
>(input: {
  readonly entry: EntryDefinition<Name, Parameters, Projection>;
  readonly parameterNames: readonly string[];
  readonly raw: RawValueMap;
  readonly coerce?: RawValueCoercer;
}): EntryDecodeResult<Parameters, Projection> {
  const decoded = decodeParameterValues({
    parameters: input.entry.parameters,
    parameterNames: input.parameterNames,
    raw: input.raw,
    ...(input.coerce ? { coerce: input.coerce } : {}),
  });
  if (decoded.kind === ENTRY_DECODE_RESULT_KIND.invalidInput) {
    return decoded;
  }
  try {
    return {
      kind: ENTRY_DECODE_RESULT_KIND.resolved,
      values: decoded.values,
      projection: input.entry.project({ values: decoded.values }),
    };
  } catch (error) {
    return error instanceof EntryInputError
      ? {
          kind: ENTRY_DECODE_RESULT_KIND.invalidInput,
          parameterName: null,
          issues: error.issues,
        }
      : { kind: ENTRY_DECODE_RESULT_KIND.internalError, error };
  }
}

function invalidParameter(
  parameterName: string,
  issues: readonly string[],
): ParameterDecodeResult<ParameterSet> {
  return {
    kind: ENTRY_DECODE_RESULT_KIND.invalidInput,
    parameterName,
    issues,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
