import { ENTRY_INPUT_TARGET_KIND } from "./values.js";

export type EntryInputTarget =
  | { readonly kind: typeof ENTRY_INPUT_TARGET_KIND.entry }
  | {
      readonly kind: typeof ENTRY_INPUT_TARGET_KIND.parameter;
      readonly parameterName: string;
    };

const ENTRY_INPUT_TARGET = {
  kind: ENTRY_INPUT_TARGET_KIND.entry,
} as const satisfies EntryInputTarget;

/** Expected invalid caller input. Unexpected schema/project faults propagate. */
export class EntryInputError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly target: EntryInputTarget = ENTRY_INPUT_TARGET,
  ) {
    super(issues.join("; "));
    this.name = EntryInputError.name;
  }
}
