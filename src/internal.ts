import type { ParameterSet } from "./model.js";

export function findParameter<const Parameters extends ParameterSet>(
  parameters: Parameters,
  name: string,
): Parameters[number] | null {
  return parameters.find((parameter) => parameter.name === name) ?? null;
}

export function requireParameter<const Parameters extends ParameterSet>(
  parameters: Parameters,
  name: string,
): Parameters[number] {
  const parameter = findParameter(parameters, name);
  if (parameter === null) {
    throw new Error(`Unknown parameter binding: ${name}`);
  }
  return parameter;
}
