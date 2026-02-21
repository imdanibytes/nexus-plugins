import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { TurnStrategyContext, TurnStrategyResult } from "../../src/strategy/types.js";
import type { RoundResult } from "../../src/round-runner.js";
import type { TransitionSignal } from "../../src/graph/types.js";
import type { TaskState } from "../../src/tasks/types.js";

// ── Module mocks ──

vi.mock("../../src/round-runner.js", () => ({
  runRound: vi.fn(),
}));

vi.mock("../../src/tasks/storage.js", () => ({
  getTaskState: vi.fn(),
  saveTaskState: vi.fn(),
}));

vi.mock("../../src/thinking.js", () => ({
  resolveThinkingConfig: vi.fn(() => undefined),
  supportsNativeThinking: vi.fn(() => false),
}));

vi.mock("../../src/compaction/pricing.js", () => ({
  resolvePrice: vi.fn(() => ({ input: 0, output: 0 })),
  calculateCost: vi.fn(() => 0),
}));

vi.mock("../../src/compaction/pipeline.js", () => ({
  truncateOldToolResults: vi.fn(),
}));

vi.mock("../../src/mechanics/loop-guard.js", () => ({
  createLoopGuardState: vi.fn(() => ({ textlessRounds: 0, recentToolNames: [] })),
  updateLoopGuard: vi.fn(),
  checkLoopGuard: vi.fn(() => ({ action: "continue" })),
}));

import { runRound } from "../../src/round-runner.js";
import { getTaskState, saveTaskState } from "../../src/tasks/storage.js";
import { AgentGraph } from "../../src/graph/runtime.js";
import { StateGraphEngine } from "../../src/graph/engine.js";
import { AGENT_GRAPH } from "../../src/graph/definition.js";

const mockRunRound = vi.mocked(runRound);
const mockGetTaskState = vi.mocked(getTaskState);
const mockSaveTaskState = vi.mocked(saveTaskState);

// ── Helpers ──

function makeTaskState(mode: TaskState["mode"] = "general"): TaskState {
  return { plan: null, tasks: {}, mode };
}

function makeEndTurnResult(): RoundResult {
  return {
    stopReason: "end_turn",
    assistantParts: [{ type: "text", text: "Hello" }],
  };
}

function makeToolUseResult(newApiMessages: unknown[] = []): RoundResult {
  return {
    stopReason: "tool_use",
    assistantParts: [{ type: "tool-call", id: "t1", name: "test", args: {}, result: "ok" }],
    newApiMessages: newApiMessages as RoundResult["newApiMessages"],
  };
}

function makeCtx(overrides: Partial<TurnStrategyContext> = {}): TurnStrategyContext {
  const mockSpan = {
    span: vi.fn(() => mockSpan),
    end: vi.fn(),
    mark: vi.fn(),
    setMetadata: vi.fn(),
  };

  return {
    config: {
      client: {} as any,
      model: "test-model",
      maxTokens: 1000,
      provider: { type: "anthropic" },
    } as any,
    systemMessageBuilder: {
      build: vi.fn(async () => "system message"),
    } as any,
    apiMessages: [],
    toolRegistry: {
      definitions: [],
      anthropicTools: [],
      executor: { has: () => false } as any,
      wireName: (n: string) => n,
      origName: (n: string) => n,
    } as any,
    toolCtx: {
      conversationId: "conv-1",
      sse: { writeEvent: vi.fn() } as any,
      conversation: {} as any,
      saveConversation: vi.fn(),
      signal: new AbortController().signal,
    },
    conversationId: "conv-1",
    conversation: {} as any,
    wireMessages: [],
    sse: { writeEvent: vi.fn() } as any,
    signal: new AbortController().signal,
    messageId: "msg-1",
    settings: {} as any,
    toolSettings: {} as any,
    contextWindow: 100000,
    turnSpan: mockSpan as any,
    maxRounds: 10,
    rebuildToolRegistry: vi.fn(async () => ({
      definitions: [],
      anthropicTools: [],
      executor: { has: () => false } as any,
      wireName: (n: string) => n,
      origName: (n: string) => n,
    })),
    ...overrides,
  };
}

// ── Tests ──

describe("AgentGraph", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);
  let graph: AgentGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks that accumulate once-queues (clearAllMocks doesn't clear those)
    mockRunRound.mockReset();
    mockGetTaskState.mockReset();
    mockSaveTaskState.mockReset();
    graph = new AgentGraph(engine);
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
  });

  describe("run() — single node, no transition", () => {
    it("returns assistant parts from a single end_turn round", async () => {
      mockRunRound.mockResolvedValueOnce(makeEndTurnResult());
      const ctx = makeCtx();

      const result = await graph.run(ctx);

      expect(result.allAssistantParts).toHaveLength(1);
      expect(result.allAssistantParts[0]).toEqual({ type: "text", text: "Hello" });
    });

    it("stays in the same mode when no transition is signaled", async () => {
      mockRunRound.mockResolvedValueOnce(makeEndTurnResult());
      const ctx = makeCtx();

      await graph.run(ctx);

      // saveTaskState should NOT be called for mode changes (only for transitions)
      expect(mockSaveTaskState).not.toHaveBeenCalled();
    });

    it("cleans up transitionSignal after run", async () => {
      mockRunRound.mockResolvedValueOnce(makeEndTurnResult());
      const ctx = makeCtx();

      await graph.run(ctx);

      expect(ctx.toolCtx.transitionSignal).toBeUndefined();
    });
  });

  describe("run() — transition between nodes", () => {
    it("transitions from general to discovery via signal", async () => {
      // First round: tool_use with transition signal set
      mockRunRound.mockImplementationOnce(async (params) => {
        // Simulate workflow_set_mode setting the transition signal
        const signal = params.toolCtx.transitionSignal as TransitionSignal;
        if (signal && !signal.requested) {
          signal.requested = true;
          signal.target = "discovery";
          signal.reason = "Gathering requirements";
        }
        return makeToolUseResult([
          { role: "assistant", content: [{ type: "text", text: "switching" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        ]);
      });

      // Second node (discovery) returns end_turn
      mockRunRound.mockResolvedValueOnce(makeEndTurnResult());

      // Use dynamic mock — return mode based on whether transition has occurred
      let transitioned = false;
      mockGetTaskState.mockImplementation(() => makeTaskState(transitioned ? "discovery" : "general"));
      mockSaveTaskState.mockImplementation(() => { transitioned = true; });

      const ctx = makeCtx();
      const result = await graph.run(ctx);

      // Both nodes' parts are collected
      expect(result.allAssistantParts.length).toBeGreaterThan(0);

      // saveTaskState was called for the transition
      expect(mockSaveTaskState).toHaveBeenCalled();
    });

    it("creates fresh transitionSignal for each node", async () => {
      const signals: TransitionSignal[] = [];

      // First call: capture signal and trigger transition
      mockRunRound.mockImplementationOnce(async (params) => {
        const signal = params.toolCtx.transitionSignal as TransitionSignal;
        signals.push({ ...signal });
        signal.requested = true;
        signal.target = "discovery";
        signal.reason = "test";
        return makeToolUseResult([
          { role: "assistant", content: [{ type: "text", text: "" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        ]);
      });

      // Second call: capture signal, end
      mockRunRound.mockImplementationOnce(async (params) => {
        const signal = params.toolCtx.transitionSignal as TransitionSignal;
        signals.push({ ...signal });
        return makeEndTurnResult();
      });

      // Dynamic mode tracking
      let transitioned = false;
      mockGetTaskState.mockImplementation(() => makeTaskState(transitioned ? "discovery" : "general"));
      mockSaveTaskState.mockImplementation(() => { transitioned = true; });

      const ctx = makeCtx();
      await graph.run(ctx);

      // Both signals started fresh (not requested)
      expect(signals[0].requested).toBe(false);
      expect(signals[1].requested).toBe(false);
    });
  });

  describe("run() — abort", () => {
    it("exits immediately when signal is already aborted", async () => {
      const abortController = new AbortController();
      abortController.abort();

      const ctx = makeCtx({ signal: abortController.signal });
      const result = await graph.run(ctx);

      expect(result.allAssistantParts).toHaveLength(0);
      expect(mockRunRound).not.toHaveBeenCalled();
    });
  });

  describe("run() — max rounds", () => {
    it("respects maxRounds across nodes", async () => {
      // Every round returns tool_use to keep looping
      mockRunRound.mockResolvedValue(makeToolUseResult([
        { role: "assistant", content: [{ type: "text", text: "" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ]));
      mockGetTaskState.mockReturnValue(makeTaskState("general"));

      const ctx = makeCtx({ maxRounds: 3 });

      const result = await graph.run(ctx);

      // Should have been called exactly 3 times (maxRounds)
      expect(mockRunRound).toHaveBeenCalledTimes(3);
    });
  });

  describe("run() — callbacks", () => {
    it("passes afterRound callbacks into the node loop", async () => {
      const afterRound = vi.fn(async () => ({ type: "continue" as const }));

      // Two tool rounds, then end
      mockRunRound
        .mockResolvedValueOnce(makeToolUseResult([
          { role: "assistant", content: [{ type: "text", text: "" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        ]))
        .mockResolvedValueOnce(makeEndTurnResult());

      mockGetTaskState.mockReturnValue(makeTaskState("general"));

      const ctx = makeCtx();
      await graph.run(ctx, { afterRound });

      // afterRound should have been called once (after the first tool_use round)
      expect(afterRound).toHaveBeenCalledTimes(1);
    });

    it("respects afterRound break action", async () => {
      const afterRound = vi.fn(async () => ({ type: "break" as const }));

      mockRunRound.mockResolvedValueOnce(makeToolUseResult([
        { role: "assistant", content: [{ type: "text", text: "" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ]));

      mockGetTaskState.mockReturnValue(makeTaskState("general"));

      const ctx = makeCtx();
      await graph.run(ctx, { afterRound });

      // Only one round — afterRound broke the loop
      expect(mockRunRound).toHaveBeenCalledTimes(1);
    });
  });

  describe("run() — pending frontend tools", () => {
    it("exits with pending frontend tool calls", async () => {
      mockRunRound.mockResolvedValueOnce({
        stopReason: "tool_use",
        assistantParts: [],
        pendingToolCalls: [{ toolCallId: "tc1", toolCallName: "frontend_tool", args: {} }],
        resolvedToolResults: [],
      });
      mockGetTaskState.mockReturnValue(makeTaskState("general"));

      const ctx = makeCtx();
      const result = await graph.run(ctx);

      expect(result.turnResult.pendingToolCalls).toHaveLength(1);
      expect(result.turnResult.pendingToolCalls![0].toolCallId).toBe("tc1");
    });
  });

  describe("run() — rebuilds tool registry per node", () => {
    it("calls rebuildToolRegistry for each node entry", async () => {
      // Trigger a transition
      mockRunRound.mockImplementationOnce(async (params) => {
        const signal = params.toolCtx.transitionSignal as TransitionSignal;
        signal.requested = true;
        signal.target = "discovery";
        signal.reason = "test";
        return makeToolUseResult([
          { role: "assistant", content: [{ type: "text", text: "" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        ]);
      });
      mockRunRound.mockResolvedValueOnce(makeEndTurnResult());

      // Dynamic mode tracking
      let transitioned = false;
      mockGetTaskState.mockImplementation(() => makeTaskState(transitioned ? "discovery" : "general"));
      mockSaveTaskState.mockImplementation(() => { transitioned = true; });

      const ctx = makeCtx();
      await graph.run(ctx);

      // rebuildToolRegistry called once per node entry
      expect(ctx.rebuildToolRegistry).toHaveBeenCalledTimes(2);
    });
  });
});
