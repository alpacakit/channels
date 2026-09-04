import type { EntryTreeEndpoint } from "./model.js";

type EndpointHandlerBinding = {
  readonly endpoint: EntryTreeEndpoint;
  readonly handler: (...args: never[]) => unknown;
};

export function createEndpointHandlers<Binding extends EndpointHandlerBinding>(
  routerEndpoints: readonly EntryTreeEndpoint[],
  bindings: readonly Binding[],
): {
  readonly issues: readonly string[];
  readonly handlers: ReadonlyMap<EntryTreeEndpoint, Binding>;
} {
  const issues: string[] = [];
  const routerEndpointSet = new Set(routerEndpoints);
  const handlers = new Map<EntryTreeEndpoint, Binding>();
  for (const binding of bindings) {
    if (!routerEndpointSet.has(binding.endpoint)) {
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
  for (const endpoint of routerEndpoints) {
    if (!handlers.has(endpoint)) {
      issues.push(`missing handler for endpoint ${endpoint.entry.name}`);
    }
  }
  return { issues, handlers };
}
