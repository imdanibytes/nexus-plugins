import { describe, it, expect, vi } from "vitest";
import { StateGraphEngine } from "../../src/graph/engine.js";
import { AGENT_GRAPH } from "../../src/graph/definition.js";
import type { StateGraphDef, StateNode, StateEdge, AgentMode, GraphContext, InterruptDef } from "../../src/graph/types.js";
import type { TaskState } from "../../src/tasks/types.js";

// ── Helpers ──

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    plan: null,
    tasks: {},
    mode: "general",
    ...overrides,
  };
}

function makeApprovedPlan(): TaskState["plan"] {
  return {
    id: "plan-1",
    conversationId: "conv-1",
    title: "Test plan",
    taskIds: [],
    approved: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeGraphContext(state: TaskState): GraphContext {
  return {
    conversationId: "conv-1",
    state,
    sse: { writeEvent: vi.fn() } as any,
  };
}

// Minimal graph for isolated engine tests
function makeMinimalGraph(): StateGraphDef {
  return {
    nodes: [
      {
        id: "general",
        description: "General",
        instructions: ["Be helpful"],
        internalTools: ["tool_a", "tool_b"],
        allowExternalTools: true,
        transitionHints: ["→ discovery"],
      },
      {
        id: "discovery",
        description: "Discovery",
        instructions: ["Ask questions"],
        internalTools: ["tool_c"],
        allowExternalTools: false,
        transitionHints: ["→ general"],
      },
    ],
    edges: [
      { from: "general", to: "discovery" },
      { from: "discovery", to: "general" },
    ],
    interrupts: [
      { type: "test_interrupt", modes: ["general"], event: "interrupt_test" },
    ],
  };
}

// ── Graph Definition Tests ──

describe("AGENT_GRAPH definition", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);
  const allModes: AgentMode[] = ["general", "discovery", "planning", "execution", "review"];

  it("defines exactly 5 nodes", () => {
    expect(AGENT_GRAPH.nodes).toHaveLength(5);
  });

  it("defines a node for every mode", () => {
    for (const mode of allModes) {
      expect(() => engine.getNode(mode)).not.toThrow();
    }
  });

  it("every node has non-empty instructions", () => {
    for (const node of AGENT_GRAPH.nodes) {
      expect(node.instructions.length).toBeGreaterThan(0);
      for (const inst of node.instructions) {
        expect(inst.trim()).not.toBe("");
      }
    }
  });

  it("every node has at least one transition hint", () => {
    for (const node of AGENT_GRAPH.nodes) {
      expect(node.transitionHints.length).toBeGreaterThan(0);
    }
  });

  it("workflow_set_mode is available in every mode", () => {
    for (const mode of allModes) {
      const tools = engine.getInternalTools(mode);
      expect(tools.has("workflow_set_mode")).toBe(true);
    }
  });

  it("only general and execution allow external tools", () => {
    expect(engine.allowsExternalTools("general")).toBe(true);
    expect(engine.allowsExternalTools("execution")).toBe(true);
    expect(engine.allowsExternalTools("discovery")).toBe(false);
    expect(engine.allowsExternalTools("planning")).toBe(false);
    expect(engine.allowsExternalTools("review")).toBe(false);
  });

  it("every edge references valid nodes", () => {
    const nodeIds = new Set(AGENT_GRAPH.nodes.map((n) => n.id));
    for (const edge of AGENT_GRAPH.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });

  it("no node has an edge to itself", () => {
    for (const edge of AGENT_GRAPH.edges) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it("every interrupt references valid modes", () => {
    const nodeIds = new Set(AGENT_GRAPH.nodes.map((n) => n.id));
    for (const intr of AGENT_GRAPH.interrupts) {
      for (const mode of intr.modes) {
        expect(nodeIds.has(mode)).toBe(true);
      }
    }
  });
});

// ── Valid Transitions ──

describe("valid transitions", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);

  const validPairs: [AgentMode, AgentMode][] = [
    ["general", "discovery"],
    ["general", "planning"],
    ["discovery", "planning"],
    ["discovery", "general"],
    ["planning", "discovery"],
    ["planning", "general"],
    ["planning", "execution"], // needs approved plan
    ["execution", "review"],
    ["execution", "discovery"],
    ["review", "execution"],
    ["review", "general"],
  ];

  it.each(validPairs)("%s → %s is a valid edge", (from, to) => {
    expect(engine.getEdge(from, to)).toBeDefined();
  });

  it("getValidTargets returns expected targets for each mode", () => {
    expect(engine.getValidTargets("general").sort()).toEqual(["discovery", "planning"]);
    expect(engine.getValidTargets("discovery").sort()).toEqual(["general", "planning"]);
    expect(engine.getValidTargets("planning").sort()).toEqual(["discovery", "execution", "general"]);
    expect(engine.getValidTargets("execution").sort()).toEqual(["discovery", "review"]);
    expect(engine.getValidTargets("review").sort()).toEqual(["execution", "general"]);
  });
});

// ── Invalid Transitions ──

describe("invalid transitions", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);

  const invalidPairs: [AgentMode, AgentMode][] = [
    ["general", "execution"],
    ["general", "review"],
    ["discovery", "execution"],
    ["discovery", "review"],
    ["planning", "review"],
    ["execution", "general"],
    ["execution", "planning"],
    ["review", "discovery"],
    ["review", "planning"],
  ];

  it.each(invalidPairs)("%s → %s is rejected", (from, to) => {
    const result = engine.validateTransition(from, to, makeState({ mode: from }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("self-transition is rejected", () => {
    const result = engine.validateTransition("general", "general", makeState());
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Already in");
  });
});

// ── Guard: planning → execution ──

describe("planning → execution guard", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);

  it("rejects when there is no plan", () => {
    const state = makeState({ mode: "planning", plan: null });
    const result = engine.validateTransition("planning", "execution", state);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("without a plan");
  });

  it("rejects when plan is not approved (null)", () => {
    const plan = makeApprovedPlan();
    plan!.approved = null;
    const state = makeState({ mode: "planning", plan });
    const result = engine.validateTransition("planning", "execution", state);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("approved");
  });

  it("rejects when plan is rejected (false)", () => {
    const plan = makeApprovedPlan();
    plan!.approved = false;
    const state = makeState({ mode: "planning", plan });
    const result = engine.validateTransition("planning", "execution", state);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("approved");
  });

  it("passes when plan is approved", () => {
    const plan = makeApprovedPlan();
    const state = makeState({ mode: "planning", plan });
    const result = engine.validateTransition("planning", "execution", state);
    expect(result.valid).toBe(true);
  });
});

// ── StateGraphEngine core ──

describe("StateGraphEngine", () => {
  it("throws for unknown mode", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    expect(() => engine.getNode("planning" as AgentMode)).toThrow("Unknown mode");
  });

  it("internalToolNames is the union of all nodes", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    expect(engine.internalToolNames).toEqual(new Set(["tool_a", "tool_b", "tool_c"]));
  });

  it("getInternalTools returns per-node tools", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    expect(engine.getInternalTools("general")).toEqual(new Set(["tool_a", "tool_b"]));
    expect(engine.getInternalTools("discovery")).toEqual(new Set(["tool_c"]));
  });

  it("getEdge returns undefined for non-existent edges", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    expect(engine.getEdge("general", "general")).toBeUndefined();
  });
});

// ── executeTransition ──

describe("executeTransition", () => {
  it("mutates state.mode on success", async () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    const result = await engine.executeTransition("general", "discovery", ctx);
    expect(result.valid).toBe(true);
    expect(state.mode).toBe("discovery");
  });

  it("does not mutate on failure", async () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    const result = await engine.executeTransition("general", "general", ctx);
    expect(result.valid).toBe(false);
    expect(state.mode).toBe("general");
  });

  it("calls hooks in correct order", async () => {
    const order: string[] = [];
    const graph: StateGraphDef = {
      nodes: [
        {
          id: "general",
          description: "",
          instructions: [],
          internalTools: [],
          allowExternalTools: true,
          transitionHints: [],
          onExit: async () => { order.push("onExit"); },
        },
        {
          id: "discovery",
          description: "",
          instructions: [],
          internalTools: [],
          allowExternalTools: false,
          transitionHints: [],
          onEnter: async () => { order.push("onEnter"); },
        },
      ],
      edges: [{
        from: "general",
        to: "discovery",
        before: async () => { order.push("before"); },
        after: async () => { order.push("after"); },
      }],
      interrupts: [],
    };

    const engine = new StateGraphEngine(graph);
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    await engine.executeTransition("general", "discovery", ctx);

    expect(order).toEqual(["before", "onExit", "onEnter", "after"]);
  });

  it("respects guards during executeTransition", async () => {
    const graph: StateGraphDef = {
      nodes: [
        { id: "general", description: "", instructions: [], internalTools: [], allowExternalTools: true, transitionHints: [] },
        { id: "discovery", description: "", instructions: [], internalTools: [], allowExternalTools: false, transitionHints: [] },
      ],
      edges: [{
        from: "general",
        to: "discovery",
        guard: () => ({ ok: false, reason: "blocked by guard" }),
      }],
      interrupts: [],
    };

    const engine = new StateGraphEngine(graph);
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    const result = await engine.executeTransition("general", "discovery", ctx);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("blocked by guard");
    expect(state.mode).toBe("general"); // unchanged
  });
});

// ── formatModeRules ──

describe("formatModeRules", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);

  it("returns description, instructions, and transitions for every mode", () => {
    const modes: AgentMode[] = ["general", "discovery", "planning", "execution", "review"];
    for (const mode of modes) {
      const rules = engine.formatModeRules(mode);
      expect(typeof rules.description).toBe("string");
      expect(rules.description.length).toBeGreaterThan(0);
      expect(Array.isArray(rules.instructions)).toBe(true);
      expect(Array.isArray(rules.transitions)).toBe(true);
    }
  });
});

// ── Interrupts ──

describe("interrupts", () => {
  it("getInterrupts returns definitions for the correct mode", () => {
    const engine = new StateGraphEngine(AGENT_GRAPH);
    const planningInterrupts = engine.getInterrupts("planning");
    expect(planningInterrupts.some((i) => i.type === "plan_approval")).toBe(true);
    expect(planningInterrupts.some((i) => i.type === "user_clarification")).toBe(false);
  });

  it("getInterrupts returns empty for modes with no interrupts", () => {
    const engine = new StateGraphEngine(AGENT_GRAPH);
    expect(engine.getInterrupts("general")).toEqual([]);
    expect(engine.getInterrupts("discovery")).toEqual([]);
    expect(engine.getInterrupts("review")).toEqual([]);
  });

  it("requestInterrupt sets state and emits SSE event", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    const result = engine.requestInterrupt("test_interrupt", ctx, { key: "value" });
    expect(result).toBe(true);
    expect(state.interrupt).toBeDefined();
    expect(state.interrupt!.type).toBe("test_interrupt");
    expect(state.interrupt!.data).toEqual({ key: "value" });
    expect(ctx.sse.writeEvent).toHaveBeenCalledOnce();
  });

  it("requestInterrupt returns false for invalid interrupt type", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "general" });
    const ctx = makeGraphContext(state);

    const result = engine.requestInterrupt("nonexistent", ctx);
    expect(result).toBe(false);
    expect(state.interrupt).toBeUndefined();
  });

  it("requestInterrupt returns false for wrong mode", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "discovery" });
    const ctx = makeGraphContext(state);

    const result = engine.requestInterrupt("test_interrupt", ctx);
    expect(result).toBe(false);
  });

  it("resolveInterrupt clears and returns previous interrupt", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const interrupt = { type: "test_interrupt", requestedAt: Date.now() };
    const state = makeState({ mode: "general", interrupt });

    const prev = engine.resolveInterrupt(state);
    expect(prev).toEqual(interrupt);
    expect(state.interrupt).toBeUndefined();
  });

  it("resolveInterrupt returns null when no interrupt", () => {
    const engine = new StateGraphEngine(makeMinimalGraph());
    const state = makeState({ mode: "general" });

    const prev = engine.resolveInterrupt(state);
    expect(prev).toBeNull();
  });
});

// ── Tool visibility per mode (integration with real definition) ──

describe("tool visibility per mode", () => {
  const engine = new StateGraphEngine(AGENT_GRAPH);

  it("planning mode has task management tools", () => {
    const tools = engine.getInternalTools("planning");
    expect(tools.has("task_create_plan")).toBe(true);
    expect(tools.has("task_create")).toBe(true);
    expect(tools.has("task_approve_plan")).toBe(true);
    expect(tools.has("delegate")).toBe(true);
  });

  it("execution mode has task update tools but not creation tools", () => {
    const tools = engine.getInternalTools("execution");
    expect(tools.has("task_update")).toBe(true);
    expect(tools.has("task_list")).toBe(true);
    expect(tools.has("task_get")).toBe(true);
    expect(tools.has("task_create_plan")).toBe(false);
    expect(tools.has("task_create")).toBe(false);
  });

  it("general mode has minimal internal tools", () => {
    const tools = engine.getInternalTools("general");
    expect(tools.has("workflow_set_mode")).toBe(true);
    expect(tools.has("batch_call")).toBe(true);
    expect(tools.has("delegate")).toBe(false);
    expect(tools.has("task_create_plan")).toBe(false);
  });

  it("discovery mode only has workflow_set_mode", () => {
    const tools = engine.getInternalTools("discovery");
    expect(tools.size).toBe(1);
    expect(tools.has("workflow_set_mode")).toBe(true);
  });
});
