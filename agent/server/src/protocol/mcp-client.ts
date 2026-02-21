import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { nexus } from "./nexus.js";

let toolsChangedHandler: (() => void) | null = null;
let registeredOn: Client | null = null;

export function setToolsChangedHandler(handler: () => void): void {
  toolsChangedHandler = handler;
}

export async function getMcpClient(): Promise<Client> {
  const client = await nexus.getMcpClient();

  // Register the tools-changed notification handler once per client instance.
  // If the SDK reconnected (new client), re-register on the new instance.
  if (client !== registeredOn) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      toolsChangedHandler?.();
    });
    registeredOn = client;
  }

  return client;
}

export async function closeMcpClient(): Promise<void> {
  registeredOn = null;
  await nexus.closeMcpClient();
}
