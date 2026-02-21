import type Anthropic from "@anthropic-ai/sdk";
import type { Conversation, SseWriter } from "../types.js";
import type { TransitionSignal } from "../graph/types.js";

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolContext {
  conversationId: string;
  sse: SseWriter;
  conversation: Conversation;
  saveConversation: (conv: Conversation) => void;
  signal: AbortSignal;
  /** LLM client — available for sub-agent delegation */
  client?: Anthropic;
  /** Model ID — available for sub-agent delegation */
  model?: string;
  /** Max output tokens — available for sub-agent delegation */
  maxTokens?: number;
  /** Temperature — available for sub-agent delegation */
  temperature?: number;
  /** Transition signal — set by workflow_set_mode to tell the graph to route. */
  transitionSignal?: TransitionSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolHandler {
  definition: ToolDefinition;
  execute(
    toolUseId: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult>;
}
