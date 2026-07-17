import {
  codecs,
  defineEntry,
  defineParameter,
  required,
} from "@alpacakit/channels";
import { z } from "zod";

const consumerSchema: z.ZodType<string> = z.string();
const consumerCodec = codecs.define({
  schema: consumerSchema,
  shape: { kind: "string" },
});

export const CompatibilityEntry = defineEntry({
  name: "zod_compatibility",
  parameters: [
    defineParameter({
      name: "value",
      codec: consumerCodec,
      requirement: required(),
      description: "Consumer-owned Zod schema",
    }),
  ],
  project: ({ values }) => values.value,
});
