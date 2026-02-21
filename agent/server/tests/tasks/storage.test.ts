import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskState, Task } from "../../src/tasks/types.js";

// ── Module mock for node:fs ──

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import fs from "node:fs";
const mockFs = vi.mocked(fs);

import { getTaskState, saveTaskState, writePlanFile, deleteTaskState } from "../../src/tasks/storage.js";

// ── Helpers ──

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "pending",
    dependsOn: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  return { plan: null, tasks: {}, mode: "general", ...overrides };
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTaskState", () => {
  it("returns empty state when file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    const state = getTaskState("conv-1");

    expect(state).toEqual({ plan: null, tasks: {}, mode: "general" });
  });

  it("returns parsed state from file", () => {
    const saved: TaskState = {
      plan: null,
      tasks: { "t1": makeTask("t1") },
      mode: "execution",
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(saved));

    const state = getTaskState("conv-1");

    expect(state.mode).toBe("execution");
    expect(state.tasks["t1"]).toBeDefined();
  });

  it("returns empty state on corrupt JSON", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("not json {{{");

    const state = getTaskState("conv-1");

    expect(state).toEqual({ plan: null, tasks: {}, mode: "general" });
  });

  it("backfills mode to 'general' when missing and no plan", () => {
    const saved = { plan: null, tasks: {} }; // no mode field
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(saved));

    const state = getTaskState("conv-1");

    expect(state.mode).toBe("general");
  });

  it("backfills mode to 'execution' when missing and plan exists", () => {
    const saved = {
      plan: { id: "p1", title: "Plan", taskIds: [], approved: true, createdAt: 0, updatedAt: 0 },
      tasks: {},
    }; // no mode field, but has plan
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(saved));

    const state = getTaskState("conv-1");

    expect(state.mode).toBe("execution");
  });

  it("reads from the correct file path", () => {
    mockFs.existsSync.mockReturnValue(false);
    getTaskState("my-conv");

    expect(mockFs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining("tasks_my-conv.json"),
    );
  });
});

describe("saveTaskState", () => {
  it("writes to tmp file and renames atomically", () => {
    mockFs.existsSync.mockReturnValue(true); // ensureDir

    const state = makeState({ mode: "planning" });
    saveTaskState("conv-1", state);

    // Should write to .tmp first
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      expect.any(String),
    );

    // Then rename
    expect(mockFs.renameSync).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      expect.stringContaining("tasks_conv-1.json"),
    );
  });

  it("creates directory if missing", () => {
    mockFs.existsSync.mockReturnValue(false); // ensureDir → missing

    saveTaskState("conv-1", makeState());

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true },
    );
  });

  it("serializes state as pretty JSON", () => {
    mockFs.existsSync.mockReturnValue(true);

    const state = makeState({ mode: "discovery" });
    saveTaskState("conv-1", state);

    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(() => JSON.parse(written)).not.toThrow();
    const parsed = JSON.parse(written);
    expect(parsed.mode).toBe("discovery");
  });
});

describe("writePlanFile", () => {
  it("returns the plan file path", () => {
    mockFs.existsSync.mockReturnValue(true);

    const fp = writePlanFile("conv-1", makeState());

    expect(fp).toContain("plan_conv-1.md");
  });

  it("writes markdown with plan title", () => {
    mockFs.existsSync.mockReturnValue(true);

    const state = makeState({
      mode: "planning",
      plan: {
        id: "p1",
        conversationId: "conv-1",
        title: "Build Feature X",
        summary: "Implement the new thing",
        taskIds: [],
        approved: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    writePlanFile("conv-1", state);

    const md = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(md).toContain("# Build Feature X");
    expect(md).toContain("Implement the new thing");
    expect(md).toContain("**Mode:** planning");
  });

  it("formats tasks with checkmarks and status", () => {
    mockFs.existsSync.mockReturnValue(true);

    const t1 = makeTask("t1", { title: "Setup", status: "completed" });
    const t2 = makeTask("t2", { title: "Implement", status: "in_progress" });
    const t3 = makeTask("t3", { title: "Test", status: "pending" });

    const state = makeState({
      mode: "execution",
      plan: {
        id: "p1",
        conversationId: "conv-1",
        title: "Plan",
        taskIds: ["t1", "t2", "t3"],
        approved: true,
        createdAt: 0,
        updatedAt: 0,
      },
      tasks: { t1, t2, t3 },
    });
    writePlanFile("conv-1", state);

    const md = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(md).toContain("[x] **Setup** [done]");
    expect(md).toContain("[>] **Implement** [in progress]");
    expect(md).toContain("[ ] **Test** [pending]");
    expect(md).toContain("1/3 tasks completed");
  });

  it("renders 'no active plan' for null plan", () => {
    mockFs.existsSync.mockReturnValue(true);

    writePlanFile("conv-1", makeState());

    const md = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(md).toContain("No active plan");
  });

  it("uses atomic write (tmp → rename)", () => {
    mockFs.existsSync.mockReturnValue(true);

    writePlanFile("conv-1", makeState());

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      expect.any(String),
    );
    expect(mockFs.renameSync).toHaveBeenCalled();
  });
});

describe("deleteTaskState", () => {
  it("returns true and deletes files when they exist", () => {
    mockFs.existsSync.mockReturnValue(true);

    const result = deleteTaskState("conv-1");

    expect(result).toBe(true);
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2); // tasks + plan
  });

  it("returns false when no files exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = deleteTaskState("conv-1");

    expect(result).toBe(false);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });
});
