import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext, ToolResult } from "../../../src/tools/types.js";
import type { TaskState } from "../../../src/tasks/types.js";

// ── Module mocks ──

vi.mock("../../../src/tasks/storage.js", () => ({
  getTaskState: vi.fn(),
  saveTaskState: vi.fn(),
  writePlanFile: vi.fn(() => "/tmp/plan.md"),
}));

vi.mock("../../../src/graph/index.js", () => ({
  graphEngine: {
    validateTransition: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-1234"),
}));

import { getTaskState, saveTaskState, writePlanFile } from "../../../src/tasks/storage.js";
import { graphEngine } from "../../../src/graph/index.js";
import {
  setModeTool,
  approvePlanTool,
  createPlanTool,
  createTaskTool,
  updateTaskTool,
  listTasksTool,
  getTaskTool,
} from "../../../src/tools/handlers/tasks.js";

const mockGetTaskState = vi.mocked(getTaskState);
const mockSaveTaskState = vi.mocked(saveTaskState);
const mockWritePlanFile = vi.mocked(writePlanFile);
const mockValidateTransition = vi.mocked(graphEngine.validateTransition);

// ── Helpers ──

function makeTaskState(mode: TaskState["mode"] = "general"): TaskState {
  return { plan: null, tasks: {}, mode };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: "conv-1",
    sse: { writeEvent: vi.fn() } as any,
    conversation: {} as any,
    saveConversation: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTaskState.mockReset();
  mockSaveTaskState.mockReset();
  mockValidateTransition.mockReset();
  mockWritePlanFile.mockReset();
  mockWritePlanFile.mockReturnValue("/tmp/plan.md");
});

describe("workflow_set_mode", () => {
  it("transitions mode and saves state", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: true });

    const ctx = makeCtx();
    const result = await setModeTool.execute("t1", { mode: "discovery", reason: "Gathering info" }, ctx);

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("general → discovery");
    expect(result.content).toContain("Gathering info");
    expect(mockSaveTaskState).toHaveBeenCalled();
  });

  it("returns error for invalid transition", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: false, reason: "Cannot transition to review from general." });

    const result = await setModeTool.execute("t1", { mode: "review" }, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Cannot transition");
  });

  it("sets transitionSignal when available", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: true });

    const signal = { requested: false, target: undefined, reason: undefined };
    const ctx = makeCtx({ transitionSignal: signal as any });
    await setModeTool.execute("t1", { mode: "discovery", reason: "test" }, ctx);

    expect(signal.requested).toBe(true);
    expect(signal.target).toBe("discovery");
    expect(signal.reason).toBe("test");
  });

  it("falls back to direct mode mutation without transitionSignal", async () => {
    const state = makeTaskState("general");
    mockGetTaskState.mockReturnValue(state);
    mockValidateTransition.mockReturnValue({ valid: true });

    await setModeTool.execute("t1", { mode: "discovery" }, makeCtx());

    // Direct mutation fallback
    expect(state.mode).toBe("discovery");
  });

  it("emits task_state_changed SSE event", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: true });

    const ctx = makeCtx();
    await setModeTool.execute("t1", { mode: "discovery" }, ctx);

    expect(ctx.sse.writeEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "task_state_changed" }),
    );
  });
});

describe("task_create_plan", () => {
  it("creates a plan and transitions to planning", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: true });

    const result = await createPlanTool.execute(
      "t1",
      { title: "Build auth", summary: "JWT-based auth" },
      makeCtx(),
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Build auth");
    expect(mockSaveTaskState).toHaveBeenCalled();
    expect(mockWritePlanFile).toHaveBeenCalled();
  });

  it("returns error when title is missing", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));

    const result = await createPlanTool.execute("t1", {}, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("title is required");
  });

  it("accepts plan_title as alias for title", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));
    mockValidateTransition.mockReturnValue({ valid: true });

    const result = await createPlanTool.execute("t1", { plan_title: "Alias title" }, makeCtx());

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Alias title");
  });

  it("does not transition if already in planning mode", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("planning"));

    const result = await createPlanTool.execute("t1", { title: "Plan" }, makeCtx());

    expect(result.is_error).toBeUndefined();
    // validateTransition not called because mode is already planning
    expect(mockValidateTransition).not.toHaveBeenCalled();
  });
});

describe("task_create", () => {
  it("creates a task and adds it to the plan", async () => {
    const state = makeTaskState("planning");
    state.plan = {
      id: "plan-1",
      conversationId: "conv-1",
      title: "Test plan",
      taskIds: [],
      approved: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      filePath: "/tmp/plan.md",
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await createTaskTool.execute(
      "t1",
      { title: "Setup DB", description: "Create schema" },
      makeCtx(),
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Setup DB");
    expect(state.plan!.taskIds).toHaveLength(1);
    expect(state.tasks["test-uuid-1234"]).toBeDefined();
    expect(state.tasks["test-uuid-1234"].title).toBe("Setup DB");
  });

  it("returns error without a plan", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));

    const result = await createTaskTool.execute("t1", { title: "Task" }, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("No active plan");
  });

  it("validates dependsOn references exist", async () => {
    const state = makeTaskState("planning");
    state.plan = {
      id: "plan-1",
      conversationId: "conv-1",
      title: "Test",
      taskIds: [],
      approved: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await createTaskTool.execute(
      "t1",
      { title: "Task", dependsOn: ["nonexistent-id"] },
      makeCtx(),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("nonexistent-id");
    expect(result.content).toContain("does not exist");
  });

  it("validates parentId exists", async () => {
    const state = makeTaskState("planning");
    state.plan = {
      id: "plan-1",
      conversationId: "conv-1",
      title: "Test",
      taskIds: [],
      approved: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await createTaskTool.execute(
      "t1",
      { title: "Task", parentId: "bad-parent" },
      makeCtx(),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("bad-parent");
  });
});

describe("task_update", () => {
  it("updates status and saves", async () => {
    const state = makeTaskState("execution");
    state.tasks["task-1"] = {
      id: "task-1",
      title: "Test task",
      status: "pending",
      dependsOn: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await updateTaskTool.execute(
      "t1",
      { taskId: "task-1", status: "in_progress" },
      makeCtx(),
    );

    expect(result.is_error).toBeUndefined();
    expect(state.tasks["task-1"].status).toBe("in_progress");
    expect(mockSaveTaskState).toHaveBeenCalled();
  });

  it("sets completedAt when marking completed", async () => {
    const state = makeTaskState("execution");
    state.tasks["task-1"] = {
      id: "task-1",
      title: "Test task",
      status: "in_progress",
      dependsOn: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    await updateTaskTool.execute(
      "t1",
      { taskId: "task-1", status: "completed" },
      makeCtx(),
    );

    expect(state.tasks["task-1"].completedAt).toBeTypeOf("number");
  });

  it("merges metadata", async () => {
    const state = makeTaskState("execution");
    state.tasks["task-1"] = {
      id: "task-1",
      title: "Test task",
      status: "in_progress",
      dependsOn: [],
      metadata: { existing: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    await updateTaskTool.execute(
      "t1",
      { taskId: "task-1", metadata: { added: "new" } },
      makeCtx(),
    );

    expect(state.tasks["task-1"].metadata).toEqual({ existing: true, added: "new" });
  });

  it("returns error for nonexistent task", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("execution"));

    const result = await updateTaskTool.execute(
      "t1",
      { taskId: "ghost" },
      makeCtx(),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("ghost");
  });
});

describe("task_approve_plan", () => {
  function stateWithPlan(): TaskState {
    const state = makeTaskState("planning");
    state.plan = {
      id: "plan-1",
      conversationId: "conv-1",
      title: "Test plan",
      taskIds: ["t1", "t2"],
      approved: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return state;
  }

  it("approves plan and transitions to execution", async () => {
    const state = stateWithPlan();
    mockGetTaskState.mockReturnValue(state);
    mockValidateTransition.mockReturnValue({ valid: true });

    const result = await approvePlanTool.execute("t1", { approved: true }, makeCtx());

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Plan approved");
    expect(result.content).toContain("2 tasks ready");
    expect(state.plan!.approved).toBe(true);
  });

  it("rejects plan with feedback", async () => {
    const state = stateWithPlan();
    mockGetTaskState.mockReturnValue(state);

    const result = await approvePlanTool.execute(
      "t1",
      { approved: false, feedback: "Need more detail" },
      makeCtx(),
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Plan rejected");
    expect(result.content).toContain("Need more detail");
    expect(state.plan!.approved).toBe(false);
  });

  it("returns error with no plan", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("planning"));

    const result = await approvePlanTool.execute("t1", { approved: true }, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("No active plan");
  });

  it("returns error if transition to execution is invalid", async () => {
    const state = stateWithPlan();
    mockGetTaskState.mockReturnValue(state);
    mockValidateTransition.mockReturnValue({ valid: false, reason: "Invalid transition" });

    const result = await approvePlanTool.execute("t1", { approved: true }, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Invalid transition");
  });
});

describe("task_list", () => {
  it("returns 'No active plan' without a plan", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("general"));

    const result = await listTasksTool.execute("t1", {}, makeCtx());

    expect(result.content).toContain("No active plan");
  });

  it("lists tasks with status icons", async () => {
    const state = makeTaskState("execution");
    state.plan = {
      id: "plan-1",
      conversationId: "conv-1",
      title: "My Plan",
      taskIds: ["task-1", "task-2"],
      approved: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.tasks["task-1"] = {
      id: "task-1",
      title: "First task",
      status: "completed",
      dependsOn: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.tasks["task-2"] = {
      id: "task-2",
      title: "Second task",
      status: "in_progress",
      dependsOn: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await listTasksTool.execute("t1", {}, makeCtx());

    expect(result.content).toContain("[x]");
    expect(result.content).toContain("[>]");
    expect(result.content).toContain("My Plan");
    expect(result.content).toContain("1/2 completed");
    expect(result.content).toContain("1 in progress");
  });
});

describe("task_get", () => {
  it("returns full task details", async () => {
    const state = makeTaskState("execution");
    state.tasks["task-1"] = {
      id: "task-1",
      title: "Important task",
      description: "Do the thing",
      status: "in_progress",
      dependsOn: ["task-0"],
      activeLabel: "Doing the thing",
      metadata: { files: 3 },
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    mockGetTaskState.mockReturnValue(state);

    const result = await getTaskTool.execute("t1", { taskId: "task-1" }, makeCtx());

    expect(result.content).toContain("Important task");
    expect(result.content).toContain("Do the thing");
    expect(result.content).toContain("in_progress");
    expect(result.content).toContain("task-0");
    expect(result.content).toContain("Doing the thing");
    expect(result.content).toContain('"files":3');
  });

  it("returns error for nonexistent task", async () => {
    mockGetTaskState.mockReturnValue(makeTaskState("execution"));

    const result = await getTaskTool.execute("t1", { taskId: "nope" }, makeCtx());

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("nope");
  });
});
