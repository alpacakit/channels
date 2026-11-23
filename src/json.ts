export type JsonPrimitive = string | number | boolean | null;
type JsonData<MissingProperty = never> =
  | JsonPrimitive
  | readonly JsonData<MissingProperty>[]
  | {
      readonly [key: string]: JsonData<MissingProperty> | MissingProperty;
    };

export type JsonValue = JsonData;

/** Zod can decode an optional object property to undefined. */
export type DecodedJsonValue = JsonData<undefined>;
