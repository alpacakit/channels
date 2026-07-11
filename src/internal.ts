import type { ParameterSet } from "./model.js";

export function findParameter<const Parameters extends ParameterSet>(
  parameters: Parameters,
  name: string,
): Parameters[number] | null {
  return parameters.find((parameter) => parameter.name === name) ?? null;
}
