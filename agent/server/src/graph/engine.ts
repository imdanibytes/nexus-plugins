import type {
  StateGraphDef,
  StateNode,
  StateEdge,
  AgentMode,
  GraphContext,
  InterruptDef,
  InterruptState,
} from "./types.js";
import type { TaskState } from "../tasks/types.js";
import { EventType } from "../ag-ui-types.js";

export class StateGraphEngine {
  private nodeMap: Map<AgentMode, StateNode>;
  private edgeIndex: Map<string, StateEdge>;
  private outEdges: Map<AgentMode, StateEdge[]>;
  private allInternalTools: Set<string>;
  private interruptsByMode: Map<AgentMode, InterruptDef[]>;

  constructor(private def: StateGraphDef) {
    this.nodeMap = new Map(def.nodes.map((n) => [n.id, n]));

    this.edgeIndex = new Map();
    this.outEdges = new Map();
    for (const edge of def.edges) {
      this.edgeIndex.set(this.edgeKey(edge.from, edge.to), edge);
      const list = this.outEdges.get(edge.from) ?? [];
      list.push(edge);
      this.outEdges.set(edge.from, list);
    }

    this.allInternalTools = new Set(def.nodes.flatMap((n) => n.internalTools));

    this.interruptsByMode = new Map();
    for (const intr of def.interrupts) {
      for (const mode of intr.modes) {
        const list = this.interruptsByMode.get(mode) ?? [];
        list.push(intr);
        this.interruptsByMode.set(mode, list);
      }
    }
  }

  private edgeKey(from: AgentMode, to: AgentMode): string {
    return `${from}->${to}`;
  }

  // ── Node queries ──

  getNode(mode: AgentMode): StateNode {
    const node = this.nodeMap.get(mode);
    if (!node) throw new Error(`Unknown mode: ${mode}`);
    return node;
  }

  /** Union of all internal tool names across every node. */
  get internalToolNames(): Set<string> {
    return this.allInternalTools;
  }

  /** Internal tools visible in the given mode. */
  getInternalTools(mode: AgentMode): Set<string> {
    return new Set(this.getNode(mode).internalTools);
  }

  /** Whether MCP / external tools are accessible in this mode. */
  allowsExternalTools(mode: AgentMode): boolean {
    return this.getNode(mode).allowExternalTools;
  }

  // ── Edge queries ──

  getEdge(from: AgentMode, to: AgentMode): StateEdge | undefined {
    return this.edgeIndex.get(this.edgeKey(from, to));
  }

  getValidTargets(from: AgentMode): AgentMode[] {
    return (this.outEdges.get(from) ?? []).map((e) => e.to);
  }

  // ── Transition logic ──

  /** Pure validation — no side effects, no hooks. */
  validateTransition(
    from: AgentMode,
    to: AgentMode,
    state: TaskState,
  ): { valid: boolean; reason?: string } {
    if (from === to) {
      return { valid: false, reason: `Already in ${from} mode.` };
    }

    const edge = this.getEdge(from, to);
    if (!edge) {
      const targets = this.getValidTargets(from);
      return {
        valid: false,
        reason: `Cannot transition from ${from} to ${to}. Valid transitions: ${targets.join(", ") || "none"}`,
      };
    }

    if (edge.guard) {
      const result = edge.guard(state);
      if (!result.ok) return { valid: false, reason: result.reason };
    }

    return { valid: true };
  }

  /**
   * Execute a full transition: validate, run hooks, mutate state.mode.
   * Does NOT persist state — caller is responsible for saveTaskState().
   *
   * Hook order: edge.before -> node.onExit -> [mutate] -> node.onEnter -> edge.after
   */
  async executeTransition(
    from: AgentMode,
    to: AgentMode,
    ctx: GraphContext,
  ): Promise<{ valid: boolean; reason?: string }> {
    const validation = this.validateTransition(from, to, ctx.state);
    if (!validation.valid) return validation;

    const edge = this.getEdge(from, to)!;
    const fromNode = this.getNode(from);
    const toNode = this.getNode(to);

    if (edge.before) await edge.before(ctx);
    if (fromNode.onExit) await fromNode.onExit(ctx, to);

    ctx.state.mode = to;

    if (toNode.onEnter) await toNode.onEnter(ctx, from);
    if (edge.after) await edge.after(ctx);

    return { valid: true };
  }

  // ── System message ──

  /** Get mode rules formatted for system message injection. */
  formatModeRules(mode: AgentMode): {
    description: string;
    instructions: string[];
    transitions: string[];
  } {
    const node = this.getNode(mode);
    return {
      description: node.description,
      instructions: node.instructions,
      transitions: node.transitionHints,
    };
  }

  // ── Interrupts ──

  getInterrupts(mode: AgentMode): InterruptDef[] {
    return this.interruptsByMode.get(mode) ?? [];
  }

  /**
   * Request an interrupt. Sets state.interrupt and emits an SSE event.
   * Returns false if the interrupt type is not valid for the current mode.
   */
  requestInterrupt(
    type: string,
    ctx: GraphContext,
    data?: Record<string, unknown>,
  ): boolean {
    const available = this.getInterrupts(ctx.state.mode);
    const def = available.find((i) => i.type === type);
    if (!def) return false;

    const interrupt: InterruptState = {
      type,
      requestedAt: Date.now(),
      data,
    };
    ctx.state.interrupt = interrupt;

    ctx.sse.writeEvent(EventType.CUSTOM, {
      name: def.event,
      value: {
        conversationId: ctx.conversationId,
        interrupt,
      },
    });

    return true;
  }

  /** Resolve (clear) the current interrupt. Returns the previous interrupt or null. */
  resolveInterrupt(state: TaskState): InterruptState | null {
    const prev = state.interrupt ?? null;
    state.interrupt = undefined;
    return prev;
  }
}
