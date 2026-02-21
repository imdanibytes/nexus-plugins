import type { Agent, Conversation, AgentSettings, WireMessage } from "../types.js";

export interface SystemMessageContext {
  conversationId: string;
  conversation: Conversation;
  tokenUsage?: { input: number; output: number; limit: number };
  toolNames: string[];
  settings: AgentSettings;
  agent?: Agent | null;
  /** Current turn wire messages — for providers needing latest user input */
  wireMessages?: WireMessage[];
}

export interface SystemMessageProvider {
  name: string;
  timeoutMs: number;
  provide(ctx: SystemMessageContext): Promise<string | null>;
}
