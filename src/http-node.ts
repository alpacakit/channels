import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { HttpRequestHandler } from "./http-handler.js";

export function createNodeRequestListener(
  handle: HttpRequestHandler,
  options?: { readonly origin?: string },
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void dispatchNodeRequest(handle, request, response, options?.origin);
  };
}

async function dispatchNodeRequest(
  handle: HttpRequestHandler,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  authoredOrigin: string | undefined,
): Promise<void> {
  let request: Request;
  try {
    request = createFetchRequest(incoming, authoredOrigin);
  } catch {
    finishEmpty(outgoing, 400);
    return;
  }
  let response: Response;
  try {
    response = await handle(request);
  } catch {
    finishEmpty(outgoing, 500);
    return;
  }
  try {
    writeFetchResponse(response, outgoing);
  } catch {
    finishEmpty(outgoing, 500);
  }
}

function createFetchRequest(
  request: IncomingMessage,
  authoredOrigin: string | undefined,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  const host = Array.isArray(request.headers.host)
    ? request.headers.host.join(", ")
    : request.headers.host;
  const origin = authoredOrigin ?? `http://${host ?? "localhost"}`;
  const method = request.method ?? "GET";
  const withBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { readonly duplex?: "half" } = {
    method,
    headers,
    ...(withBody
      ? {
          body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
          duplex: "half" as const,
        }
      : {}),
  };
  return new Request(`${origin}${request.url ?? "/"}`, init);
}

function writeFetchResponse(
  response: Response,
  outgoing: ServerResponse,
): void {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    outgoing.end();
    return;
  }
  const body = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  );
  body.on("error", () => outgoing.destroy());
  body.pipe(outgoing);
}

function finishEmpty(response: ServerResponse, status: number): void {
  try {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(status);
    response.end();
  } catch {
    response.destroy();
  }
}
