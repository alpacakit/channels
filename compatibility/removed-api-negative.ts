// These imports are negative controls for removed public APIs and subpaths.
// @ts-expect-error the library no longer owns CLI execution
import { handleCliEndpoint } from "@alpacakit/channels/cli";
// @ts-expect-error the library no longer owns HTTP execution
import { handleHttpEndpoint } from "@alpacakit/channels/http";
// @ts-expect-error MCP uses the recursive collector, not individual SDK wrappers
import { createMcpEndpoint } from "@alpacakit/channels/mcp";
// @ts-expect-error the Node HTTP runtime subpath was removed
import "@alpacakit/channels/http/node";

void handleCliEndpoint;
void handleHttpEndpoint;
void createMcpEndpoint;
