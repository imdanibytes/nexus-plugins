import { setToolsChangedHandler } from "../protocol/mcp-client.js";
import { invalidateMcpToolCache } from "./handlers/remote.js";
import { hub } from "../sse-handler.js";
import { EventType } from "../ag-ui-types.js";

/** Start listening for MCP tool changes from the Nexus Host API. */
export function startToolEventListener(): void {
  setToolsChangedHandler(() => {
    // Invalidating the MCP cache is sufficient — tool-registry.ts rebuilds
    // the executor each turn using fetchMcpToolHandlers() which respects this cache.
    invalidateMcpToolCache();
    hub.push({ type: EventType.CUSTOM, name: "tools_changed", value: {} });
  });
}
