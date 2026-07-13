const AUTHORED_CLI_VALUE_NAMES = new WeakSet<object>();

export function registerAuthoredCliValueName(binding: object): void {
  AUTHORED_CLI_VALUE_NAMES.add(binding);
}

export function hasAuthoredCliValueName(binding: object): boolean {
  return AUTHORED_CLI_VALUE_NAMES.has(binding);
}
