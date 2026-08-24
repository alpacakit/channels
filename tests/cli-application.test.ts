import { describe, expect, it } from "vitest";
import {
  CLI_COMMAND_EXIT_CODE,
  CLI_GLOBAL_OPTION_ISSUE_KIND,
  CLI_GLOBAL_OPTION_RESULT_KIND,
  CLI_OUTPUT_FORMAT,
  CLI_RESULT_CODE,
  CLI_RESULT_STATUS,
  createCliCommandExecutionResult,
  createCliResultEnvelope,
  createCliResultProjection,
  extractCliGlobalValueOption,
  parseCliHelpRequest,
  projectCliResultEnvelope,
  verifyCliResultEnvelope,
} from "../src/cli.js";

const HELP = {
  commandToken: "help",
  optionTokens: ["--help", "-h"],
  allToken: "--all",
} as const;

const FORMAT = {
  flag: "--format",
  values: ["text", "json"],
} as const;

describe("CLI application grammar", () => {
  it("parses empty, command, all, and trailing help requests", () => {
    expect(parseCliHelpRequest([], HELP)).toEqual({
      kind: "path",
      path: [],
      all: false,
    });
    expect(parseCliHelpRequest(["help", "repo", "--all"], HELP)).toEqual({
      kind: "path",
      path: ["repo"],
      all: true,
    });
    expect(parseCliHelpRequest(["repo", "status", "-h"], HELP)).toEqual({
      kind: "path",
      path: ["repo", "status"],
      all: false,
    });
    expect(parseCliHelpRequest(["help", "--all", "repo"], HELP)).toBeNull();
    expect(parseCliHelpRequest(["repo", "--help", "--all"], HELP)).toBeNull();
  });

  it("extracts one global value option and respects the option terminator", () => {
    expect(extractCliGlobalValueOption(["status"], FORMAT)).toEqual({
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.absent,
    });
    expect(
      extractCliGlobalValueOption(["--format=json", "status"], FORMAT),
    ).toEqual({
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.resolved,
      value: "json",
      argv: ["status"],
    });
    expect(
      extractCliGlobalValueOption(["show", "--", "--format", "json"], FORMAT),
    ).toEqual({ kind: CLI_GLOBAL_OPTION_RESULT_KIND.absent });
    expect(
      extractCliGlobalValueOption(
        ["--format", "json", "--format=text", "status"],
        FORMAT,
      ),
    ).toEqual({
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.invalid,
      issue: CLI_GLOBAL_OPTION_ISSUE_KIND.duplicate,
    });
    expect(
      extractCliGlobalValueOption(["status", "--format", "yaml"], FORMAT),
    ).toEqual({
      kind: CLI_GLOBAL_OPTION_RESULT_KIND.invalid,
      issue: CLI_GLOBAL_OPTION_ISSUE_KIND.invalidValue,
    });
  });
});

describe("CLI result envelope", () => {
  it("creates and verifies one versioned result", () => {
    expect(
      createCliResultEnvelope({
        dataVersion: "status/v1",
        command: "status",
        status: CLI_RESULT_STATUS.completed,
        code: "ok",
        data: { ready: true },
      }),
    ).toEqual({
      envelopeVersion: 1,
      dataVersion: "status/v1",
      command: "status",
      status: "completed",
      code: "ok",
      data: { ready: true },
      nextActions: [],
    });
  });

  it("projects text and JSON from one typed command result", () => {
    const result = createCliResultProjection({
      status: CLI_RESULT_STATUS.completed,
      code: CLI_RESULT_CODE.ok,
      data: { ready: true },
      text: "Ready\n",
    });

    expect(CLI_OUTPUT_FORMAT).toEqual({ text: "text", json: "json" });
    expect(result.text).toBe("Ready\n");
    expect(
      projectCliResultEnvelope({
        dataVersion: "status/v1",
        command: "status",
        result,
      }),
    ).toMatchObject({
      dataVersion: "status/v1",
      command: "status",
      status: "completed",
      data: { ready: true },
    });
  });

  it("owns the typed command result and exit-code invariant", () => {
    expect(
      createCliCommandExecutionResult({
        exitCode: CLI_COMMAND_EXIT_CODE.syntax,
        status: CLI_RESULT_STATUS.rejected,
        code: "invalid_argument",
        data: { option: "--bad" },
        text: "Invalid argument\n",
      }),
    ).toMatchObject({
      exitCode: 2,
      result: { status: CLI_RESULT_STATUS.rejected },
    });

    expect(() =>
      createCliCommandExecutionResult({
        exitCode: CLI_COMMAND_EXIT_CODE.success,
        status: CLI_RESULT_STATUS.partial,
        code: "partially_applied",
        data: null,
        text: "Partially applied\n",
      }),
    ).toThrow("partial results require exit 1");
  });

  it("rejects an invalid data version", () => {
    expect(() =>
      verifyCliResultEnvelope({
        envelopeVersion: 1,
        dataVersion: "status",
        command: "status",
        status: CLI_RESULT_STATUS.rejected,
        code: "failed",
        data: null,
        nextActions: [],
      }),
    ).toThrow();
  });

  it("rejects inconsistent completion status and code", () => {
    expect(() =>
      verifyCliResultEnvelope({
        envelopeVersion: 1,
        dataVersion: "status/v1",
        command: "status",
        status: CLI_RESULT_STATUS.completed,
        code: "failed",
        data: null,
        nextActions: [],
      }),
    ).toThrow("Completed results require code=ok");
  });
});
