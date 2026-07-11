import type {
  CLI_ROUTER_RESULT_KIND,
  CliResolvedEndpointResult,
  CliRouter,
  CliRouterResult,
} from "./cli-model.js";
import type { EntryTreeEndpoint } from "./model.js";

type ResolvedCliResult = Extract<
  CliRouterResult,
  { readonly kind: typeof CLI_ROUTER_RESULT_KIND.resolved }
>;

export type CliEndpointHandlerBinding<
  Endpoint extends EntryTreeEndpoint = EntryTreeEndpoint,
  Result = unknown,
> = {
  readonly endpoint: Endpoint;
  readonly handler: (
    input: CliResolvedEndpointResult<Endpoint>,
  ) => Result | Promise<Result>;
};

export type CliEndpointHandlerRegistration<Result = unknown> = {
  readonly endpoint: EntryTreeEndpoint;
  readonly handler: (...args: never[]) => Result | Promise<Result>;
};

export class CliExecutorDefinitionError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid CLI executor definition:\n${issues.join("\n")}`);
    this.name = CliExecutorDefinitionError.name;
  }
}

export function handleCliEndpoint<
  const Endpoint extends EntryTreeEndpoint,
  Result,
>(
  endpoint: Endpoint,
  handler: (
    input: CliResolvedEndpointResult<Endpoint>,
  ) => Result | Promise<Result>,
): CliEndpointHandlerBinding<Endpoint, Result> {
  return { endpoint, handler };
}

type CliHandlerResult<
  Bindings extends readonly CliEndpointHandlerRegistration[],
> = Awaited<ReturnType<Bindings[number]["handler"]>>;

export type CliExecutor<
  Bindings extends readonly CliEndpointHandlerRegistration[],
> = {
  execute(result: ResolvedCliResult): Promise<CliHandlerResult<Bindings>>;
};

export function createCliExecutor<
  const Bindings extends readonly CliEndpointHandlerRegistration[],
>(router: CliRouter, bindings: Bindings): CliExecutor<Bindings> {
  const issues: string[] = [];
  const routerEndpoints = new Set(router.endpoints);
  const handlers = new Map<EntryTreeEndpoint, Bindings[number]>();
  for (const binding of bindings) {
    if (!routerEndpoints.has(binding.endpoint)) {
      issues.push(
        `handler endpoint ${binding.endpoint.entry.name} is not in the router`,
      );
    }
    if (handlers.has(binding.endpoint)) {
      issues.push(
        `duplicate handler for endpoint ${binding.endpoint.entry.name}`,
      );
    }
    handlers.set(binding.endpoint, binding);
  }
  for (const endpoint of router.endpoints) {
    if (!handlers.has(endpoint)) {
      issues.push(`missing handler for endpoint ${endpoint.entry.name}`);
    }
  }
  if (issues.length > 0) {
    throw new CliExecutorDefinitionError(issues);
  }
  const execute = async (result: ResolvedCliResult): Promise<unknown> => {
    const binding = handlers.get(result.endpoint);
    if (!binding) {
      throw new CliExecutorDefinitionError([
        `missing handler for endpoint ${result.endpoint.entry.name}`,
      ]);
    }
    const handler = binding.handler as unknown as (
      input: ResolvedCliResult,
    ) => unknown;
    return await handler(result);
  };
  return { execute } as CliExecutor<Bindings>;
}
