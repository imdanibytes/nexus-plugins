import type { TaskState } from "../tasks/types.js";
import type { MessagePart, SseWriter } from "../types.js";
import type { PendingToolCall, ResolvedToolResult } from "../ag-ui-types.js";

export type AgentMode = "general" | "discovery" | "planning" | "execution" | "review";

/** Context available to all hooks and conditions. */
export interface GraphContext {
  conversationId: string;
  state: TaskState;
  sse: SseWriter;
}

/** A node in the state graph — one agent workflow mode. */
export interface StateNode {
  id: AgentMode;
  description: string;
  instructions: string[];
  /** Internal tool names visible in this mode. */
  internalTools: string[];
  /** Whether MCP / external tools are accessible. */
  allowExternalTools: boolean;
  /** Human-readable transition hints injected into the system message. */
  transitionHints: string[];
  onEnter?: (ctx: GraphContext, from: AgentMode) => Promise<void>;
  onExit?: (ctx: GraphContext, to: AgentMode) => Promise<void>;
}

/** A directed edge between two modes with an optional guard condition. */
export interface StateEdge {
  from: AgentMode;
  to: AgentMode;
  /** If present, must return ok:true for the transition to proceed. */
  guard?: (state: TaskState) => { ok: boolean; reason?: string };
  before?: (ctx: GraphContext) => Promise<void>;
  after?: (ctx: GraphContext) => Promise<void>;
}

/** A named interrupt type that can be triggered in specific modes. */
export interface InterruptDef {
  type: string;
  modes: AgentMode[];
  /** SSE event name emitted when the interrupt fires. */
  event: string;
}

/** Runtime interrupt state, persisted in TaskState. */
export interface InterruptState {
  type: string;
  requestedAt: number;
  data?: Record<string, unknown>;
}

/** Complete graph definition — pure data, no runtime behavior. */
export interface StateGraphDef {
  nodes: StateNode[];
  edges: StateEdge[];
  interrupts: InterruptDef[];
}

// ── Runtime types (used by graph/runtime.ts) ──

/**
 * Mutable signal set by workflow_set_mode tool to request a transition.
 * Created per-node by the graph runtime, attached to ToolContext so
 * the tool can set it without knowing about the graph.
 */
export interface TransitionSignal {
  requested: boolean;
  target: AgentMode | null;
  reason: string;
}

/** Result of running a single graph node (mode). */
export interface NodeRunResult {
  reason: "end_turn" | "transition" | "abort" | "interrupt" | "pending_frontend" | "max_rounds";
  transition?: { to: AgentMode; reason: string };
  assistantParts: MessagePart[];
  turnResult: {
    pendingToolCalls?: PendingToolCall[];
    resolvedToolResults?: ResolvedToolResult[];
  };
  /** Number of LLM rounds consumed by this node (used by graph runtime for global round budget). */
  roundsUsed?: number;
}
