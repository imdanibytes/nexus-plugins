import type Anthropic from "@anthropic-ai/sdk";
import type { SystemMessageBuilder } from "../system-message/builder.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { TurnConfig } from "../turn-config.js";
import type {
  Conversation, MessagePart, SseWriter, WireMessage,
  AgentSettings, ToolSettings,
} from "../types.js";
import type { SpanHandle } from "../timing.js";
import type { RoundResult } from "../round-runner.js";
import type { PendingToolCall, ResolvedToolResult } from "../ag-ui-types.js";

// ── Graph Runtime Context ──

export interface TurnStrategyContext {
  config: TurnConfig;
  systemMessageBuilder: SystemMessageBuilder;
  apiMessages: Anthropic.MessageParam[];
  toolRegistry: ToolRegistry;
  toolCtx: ToolContext;
  conversationId: string;
  conversation: Conversation;
  wireMessages: WireMessage[];
  sse: SseWriter;
  signal: AbortSignal;
  messageId: string;
  settings: AgentSettings;
  toolSettings: ToolSettings;
  contextWindow: number;
  turnSpan: SpanHandle;
  maxRounds: number;
  frontendTools?: ToolDefinition[];
  /** Callback to rebuild tool registry when agent mode changes */
  rebuildToolRegistry: () => Promise<ToolRegistry>;
}

export interface TurnStrategyResult {
  allAssistantParts: MessagePart[];
  turnResult: {
    pendingToolCalls?: PendingToolCall[];
    resolvedToolResults?: ResolvedToolResult[];
  };
}

// ── After-Round Callback ──

export interface AfterRoundContext {
  round: number;
  result: RoundResult;
  apiMessages: Anthropic.MessageParam[];
  assistantPartsThisRound: MessagePart[];
  config: TurnConfig;
  sse: SseWriter;
  signal: AbortSignal;
  conversation: Conversation;
  contextWindow: number;
  turnSpan: SpanHandle;
}

export type AfterRoundAction =
  | { type: "continue" }
  | {
      type: "inject_and_continue";
      messages: Anthropic.MessageParam[];
      /** Token usage from extra work (e.g. sub-agent critique) */
      extraUsage?: { input: number; output: number };
    }
  | { type: "break" };

export interface RoundLoopCallbacks {
  /**
   * Called after each round that ends with tool_use (before the next round).
   * Can inject additional messages (critique feedback, verification errors)
   * into the apiMessages array.
   */
  afterRound?(ctx: AfterRoundContext): Promise<AfterRoundAction>;
}
