import { type JsonValue, jsonValueSchema } from "@alpacakit/core";
import { z } from "zod";

export const CLI_RESULT_STATUS = {
  completed: "completed",
  rejected: "rejected",
  partial: "partial",
} as const;

export const CLI_RESULT_CODE = {
  ok: "ok",
} as const;

/**
 * Process exit classes for commands that produced a typed result. Unexpected
 * process faults sit outside this contract and are projected by the host.
 */
export const CLI_COMMAND_EXIT_CODE = {
  success: 0,
  rejected: 1,
  syntax: 2,
} as const;

export const CLI_OUTPUT_FORMAT = {
  text: "text",
  json: "json",
} as const;

export type CliOutputFormat =
  (typeof CLI_OUTPUT_FORMAT)[keyof typeof CLI_OUTPUT_FORMAT];

export type CliResultStatus =
  (typeof CLI_RESULT_STATUS)[keyof typeof CLI_RESULT_STATUS];

export type CliCommandExitCode =
  (typeof CLI_COMMAND_EXIT_CODE)[keyof typeof CLI_COMMAND_EXIT_CODE];

export type CliDataVersion = `${string}/v${number}`;

export type CliNextAction = {
  readonly label: string;
  readonly command: string;
};

export type CliResultEnvelope<Data extends JsonValue = JsonValue> = {
  readonly envelopeVersion: 1;
  readonly dataVersion: CliDataVersion;
  readonly command: string;
  readonly status: CliResultStatus;
  readonly code: string;
  readonly data: Data;
  readonly nextActions: readonly CliNextAction[];
};

/** One typed command result from which text and the JSON envelope are projected. */
export type CliResultProjection<Data extends JsonValue = JsonValue> = {
  readonly status: CliResultStatus;
  readonly code: string;
  readonly data: Data;
  readonly nextActions: readonly CliNextAction[];
  readonly text: string;
};

/** A command's typed result paired with its process exit classification. */
export type CliCommandExecutionResult<Data extends JsonValue = JsonValue> = {
  readonly exitCode: CliCommandExitCode;
  readonly result: CliResultProjection<Data>;
};

const cliNextActionSchema = z
  .object({ label: z.string(), command: z.string() })
  .strict()
  .readonly();

const cliResultProjectionSchema = z
  .object({
    status: z.enum(Object.values(CLI_RESULT_STATUS)),
    code: z.string().min(1),
    data: jsonValueSchema,
    nextActions: z.array(cliNextActionSchema).readonly(),
    text: z.string(),
  })
  .strict()
  .readonly();

export const cliCommandExecutionResultSchema = z
  .object({
    exitCode: z.enum(CLI_COMMAND_EXIT_CODE),
    result: cliResultProjectionSchema,
  })
  .strict()
  .superRefine((execution, context) => {
    const expectedExitCode =
      execution.result.status === CLI_RESULT_STATUS.completed
        ? CLI_COMMAND_EXIT_CODE.success
        : CLI_COMMAND_EXIT_CODE.rejected;
    const valid =
      execution.result.status === CLI_RESULT_STATUS.rejected
        ? execution.exitCode === CLI_COMMAND_EXIT_CODE.rejected ||
          execution.exitCode === CLI_COMMAND_EXIT_CODE.syntax
        : execution.exitCode === expectedExitCode;
    if (!valid) {
      context.addIssue({
        code: "custom",
        message:
          "Completed results require exit 0, partial results require exit 1, and rejected results require exit 1 or 2.",
      });
    }
  })
  .readonly();

const cliResultEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    dataVersion: z.string().regex(/^[a-z0-9-]+\/v[1-9][0-9]*$/u),
    command: z.string(),
    status: z.enum(Object.values(CLI_RESULT_STATUS)),
    code: z.string().min(1),
    data: jsonValueSchema,
    nextActions: z.array(cliNextActionSchema).readonly(),
  })
  .strict()
  .superRefine((document, context) => {
    const completed = document.status === CLI_RESULT_STATUS.completed;
    if (completed !== (document.code === CLI_RESULT_CODE.ok)) {
      context.addIssue({
        code: "custom",
        message: "Completed results require code=ok and failures forbid it.",
      });
    }
  })
  .readonly();

export function createCliResultEnvelope<Data extends JsonValue>(input: {
  readonly dataVersion: CliDataVersion;
  readonly command: string;
  readonly status: CliResultStatus;
  readonly code: string;
  readonly data: Data;
  readonly nextActions?: readonly CliNextAction[];
}): CliResultEnvelope<Data> {
  return verifyCliResultEnvelope({
    envelopeVersion: 1,
    dataVersion: input.dataVersion,
    command: input.command,
    status: input.status,
    code: input.code,
    data: input.data,
    nextActions: input.nextActions ?? [],
  }) as CliResultEnvelope<Data>;
}

export function createCliResultProjection<Data extends JsonValue>(input: {
  readonly status: CliResultStatus;
  readonly code: string;
  readonly data: Data;
  readonly nextActions?: readonly CliNextAction[];
  readonly text: string;
}): CliResultProjection<Data> {
  const verified = createCliResultEnvelope({
    dataVersion: "projection/v1",
    command: "projection",
    status: input.status,
    code: input.code,
    data: input.data,
    ...(input.nextActions === undefined
      ? {}
      : { nextActions: input.nextActions }),
  });
  return Object.freeze({
    status: verified.status,
    code: verified.code,
    data: verified.data,
    nextActions: verified.nextActions,
    text: input.text,
  });
}

export function createCliCommandExecutionResult<Data extends JsonValue>(input: {
  readonly exitCode: CliCommandExitCode;
  readonly status: CliResultStatus;
  readonly code: string;
  readonly data: Data;
  readonly nextActions?: readonly CliNextAction[];
  readonly text: string;
}): CliCommandExecutionResult<Data> {
  return cliCommandExecutionResultSchema.parse({
    exitCode: input.exitCode,
    result: createCliResultProjection({
      status: input.status,
      code: input.code,
      data: input.data,
      ...(input.nextActions === undefined
        ? {}
        : { nextActions: input.nextActions }),
      text: input.text,
    }),
  }) as CliCommandExecutionResult<Data>;
}

export function projectCliResultEnvelope<Data extends JsonValue>(input: {
  readonly dataVersion: CliDataVersion;
  readonly command: string;
  readonly result: CliResultProjection<Data>;
}): CliResultEnvelope<Data> {
  return createCliResultEnvelope({
    dataVersion: input.dataVersion,
    command: input.command,
    status: input.result.status,
    code: input.result.code,
    data: input.result.data,
    nextActions: input.result.nextActions,
  });
}

export function verifyCliResultEnvelope(input: unknown): CliResultEnvelope {
  return cliResultEnvelopeSchema.parse(input) as CliResultEnvelope;
}
