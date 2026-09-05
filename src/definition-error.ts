export class EntryTreeDefinitionError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid entry tree definition:\n${issues.join("\n")}`);
    this.name = EntryTreeDefinitionError.name;
  }
}
