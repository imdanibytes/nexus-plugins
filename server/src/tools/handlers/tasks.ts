import { v4 as uuidv4 } from "uuid";
import type { ToolHandler, ToolResult, ToolContext } from "../types.js";
import { EventType } from "../../ag-ui-types.js";
import { getTaskState, saveTaskState, writePlanFile } from "../../tasks/storage.js";
import type { Task, TaskStatus, Plan, TaskState, AgentMode } from "../../tasks/types.js";

// ── Valid mode transitions ──

const VALID_TRANSITIONS: Record<AgentMode, AgentMode[]> = {
  general: ["discovery"],
  discovery: ["planning", "general"],
  planning: ["execution", "discovery", "general"],
  execution: ["review", "discovery"],
  review: ["execution", "general"],
};

// ── Helper: emit full task state snapshot to UI ──

function emitTaskState(ctx: ToolContext, state: TaskState): void {
  ctx.sse.writeEvent(EventType.CUSTOM, {
    name: "task_state_changed",
    value: {
      conversationId: ctx.conversationId,
      plan: state.plan,
      tasks: state.tasks,
      mode: state.mode,
    },
  });
}

// ── workflow_set_mode ──

export const setModeTool: ToolHandler = {
  definition: {
    name: "workflow_set_mode",
    description:
      "Transition the agent workflow to a different mode. Each mode changes which tools are available and how you should behave. " +
      "Use when you've completed the work for your current phase and are ready to move on. " +
      "Do NOT call this repeatedly or transition back and forth — each transition should be purposeful. " +
      "Modes: general (freeform chat), discovery (gathering requirements — no code), planning (designing solution — no implementation), " +
      "execution (working through approved plan), review (auditing completed work). " +
      "Transition from planning→execution requires an approved plan. Include a reason so the user understands why you're transitioning.",
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["general", "discovery", "planning", "execution", "review"],
          description: "The target mode to transition to",
        },
        reason: {
          type: "string",
          description: "Brief reason for the transition (shown to user)",
        },
      },
      required: ["mode"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const target = args.mode as AgentMode;
    const reason = ((args.reason as string) || "").trim();

    const state = getTaskState(ctx.conversationId);
    const current = state.mode;

    // Validate transition
    if (target === current) {
      return { tool_use_id: toolUseId, content: `Already in ${current} mode.` };
    }

    const allowed = VALID_TRANSITIONS[current];
    if (!allowed?.includes(target)) {
      return {
        tool_use_id: toolUseId,
        content: `Cannot transition from ${current} to ${target}. Valid transitions: ${allowed?.join(", ") || "none"}`,
        is_error: true,
      };
    }

    // Gate: planning → execution requires approved plan
    if (current === "planning" && target === "execution") {
      if (!state.plan) {
        return {
          tool_use_id: toolUseId,
          content: "Cannot enter execution mode without a plan. Create one with task_create_plan first.",
          is_error: true,
        };
      }
      if (state.plan.approved !== true) {
        return {
          tool_use_id: toolUseId,
          content: "Cannot enter execution mode — plan must be approved first. Use task_approve_plan.",
          is_error: true,
        };
      }
    }

    state.mode = target;
    saveTaskState(ctx.conversationId, state);

    // Update plan file if it exists
    if (state.plan) {
      const fp = writePlanFile(ctx.conversationId, state);
      state.plan.filePath = fp;
      saveTaskState(ctx.conversationId, state);
    }

    emitTaskState(ctx, state);

    const msg = reason
      ? `Mode: ${current} → ${target} (${reason})`
      : `Mode: ${current} → ${target}`;
    return { tool_use_id: toolUseId, content: msg };
  },
};

// ── task_approve_plan ──

export const approvePlanTool: ToolHandler = {
  definition: {
    name: "task_approve_plan",
    description:
      "Mark the current plan as approved or rejected based on user feedback. " +
      "Use ONLY after presenting the full plan to the user and receiving their explicit confirmation or rejection. " +
      "Do NOT call this preemptively — the user must have seen and responded to the plan. " +
      "Approving automatically transitions to execution mode. Rejecting keeps you in planning mode to revise. " +
      "Include user feedback on rejection so you know what to change.",
    input_schema: {
      type: "object",
      properties: {
        approved: {
          type: "boolean",
          description: "true to approve, false to reject",
        },
        feedback: {
          type: "string",
          description: "User feedback (especially useful on rejection)",
        },
      },
      required: ["approved"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const approved = args.approved as boolean;
    const feedback = ((args.feedback as string) || "").trim();

    const state = getTaskState(ctx.conversationId);
    if (!state.plan) {
      return {
        tool_use_id: toolUseId,
        content: "No active plan to approve.",
        is_error: true,
      };
    }

    state.plan.approved = approved;
    state.plan.updatedAt = Date.now();

    if (approved) {
      // Auto-transition to execution
      state.mode = "execution";
    }

    // Update plan file
    const fp = writePlanFile(ctx.conversationId, state);
    state.plan.filePath = fp;

    saveTaskState(ctx.conversationId, state);
    emitTaskState(ctx, state);

    if (approved) {
      return {
        tool_use_id: toolUseId,
        content: `Plan approved. Mode: planning → execution. ${state.plan.taskIds.length} tasks ready.`,
      };
    } else {
      return {
        tool_use_id: toolUseId,
        content: `Plan rejected${feedback ? `: ${feedback}` : ""}. Revise the plan and present it again.`,
      };
    }
  },
};

// ── task_create_plan ──

export const createPlanTool: ToolHandler = {
  definition: {
    name: "task_create_plan",
    description:
      "Create a new plan for the current conversation, establishing the overall goal before breaking it into tasks. " +
      "Use after discovery is complete and you have enough requirements to design a solution. " +
      "Do NOT create a plan for trivial requests that don't need decomposition. " +
      "Replaces any existing plan. Automatically transitions to planning mode. " +
      "The title and summary are shown to the user in the task panel — make them clear and concise. " +
      "Call task_create after this to add individual tasks to the plan.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title for the plan (e.g., 'Implement user authentication')",
        },
        summary: {
          type: "string",
          description: "Brief summary of the overall approach and goals",
        },
      },
      required: ["title"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const title = ((args.title as string) || "").trim();
    if (!title) {
      return { tool_use_id: toolUseId, content: "Plan title is required", is_error: true };
    }

    const state = getTaskState(ctx.conversationId);
    const now = Date.now();

    state.plan = {
      id: uuidv4(),
      conversationId: ctx.conversationId,
      title,
      summary: ((args.summary as string) || "").trim() || undefined,
      taskIds: [],
      approved: null,
      createdAt: now,
      updatedAt: now,
    };

    // Auto-transition to planning mode
    if (state.mode === "general" || state.mode === "discovery") {
      state.mode = "planning";
    }

    // Write plan markdown file
    const fp = writePlanFile(ctx.conversationId, state);
    state.plan.filePath = fp;

    saveTaskState(ctx.conversationId, state);
    emitTaskState(ctx, state);

    return {
      tool_use_id: toolUseId,
      content: `Plan created: "${title}" (${state.plan.id})\nPlan file: ${fp}\nMode: ${state.mode}`,
    };
  },
};

// ── task_create ──

export const createTaskTool: ToolHandler = {
  definition: {
    name: "task_create",
    description:
      "Add a task to the current plan. Each task is a discrete, completable unit of work. " +
      "Use during planning mode to decompose the plan into ordered steps. " +
      "Do NOT create tasks without a plan — call task_create_plan first. " +
      "Keep tasks small enough to complete in one focused pass. Set dependsOn for tasks that must wait on others. " +
      "Use parentId for subtask grouping (display-only hierarchy). " +
      "Provide an activeLabel (present continuous form like 'Setting up schema') for the UI progress spinner.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Brief imperative title (e.g., 'Set up database schema')",
        },
        description: {
          type: "string",
          description: "Detailed description of what needs to be done",
        },
        parentId: {
          type: "string",
          description: "Parent task ID for subtask grouping (optional)",
        },
        dependsOn: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that must complete before this task can start",
        },
        activeLabel: {
          type: "string",
          description: "Present continuous label for UI spinner (e.g., 'Setting up database schema')",
        },
        metadata: {
          type: "object",
          description: "Optional metadata to attach",
        },
      },
      required: ["title"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const title = ((args.title as string) || "").trim();
    if (!title) {
      return { tool_use_id: toolUseId, content: "Task title is required", is_error: true };
    }

    const state = getTaskState(ctx.conversationId);
    if (!state.plan) {
      return {
        tool_use_id: toolUseId,
        content: "No active plan. Call task_create_plan first.",
        is_error: true,
      };
    }

    // Validate dependsOn references
    const dependsOn = (args.dependsOn as string[]) || [];
    for (const dep of dependsOn) {
      if (!state.tasks[dep]) {
        return {
          tool_use_id: toolUseId,
          content: `Dependency task "${dep}" does not exist`,
          is_error: true,
        };
      }
    }

    // Validate parentId
    const parentId = (args.parentId as string) || undefined;
    if (parentId && !state.tasks[parentId]) {
      return {
        tool_use_id: toolUseId,
        content: `Parent task "${parentId}" does not exist`,
        is_error: true,
      };
    }

    const now = Date.now();
    const task: Task = {
      id: uuidv4(),
      title,
      description: ((args.description as string) || "").trim() || undefined,
      status: "pending",
      parentId,
      dependsOn,
      activeLabel: ((args.activeLabel as string) || "").trim() || undefined,
      metadata: (args.metadata as Record<string, unknown>) || undefined,
      createdAt: now,
      updatedAt: now,
    };

    state.tasks[task.id] = task;
    state.plan.taskIds.push(task.id);
    state.plan.updatedAt = now;

    // Update plan file
    if (state.plan.filePath) {
      writePlanFile(ctx.conversationId, state);
    }

    saveTaskState(ctx.conversationId, state);
    emitTaskState(ctx, state);

    return {
      tool_use_id: toolUseId,
      content: `Task created: [${task.id}] "${title}"`,
    };
  },
};

// ── task_update ──

export const updateTaskTool: ToolHandler = {
  definition: {
    name: "task_update",
    description:
      "Update a task's status or details during execution. " +
      "Use to mark tasks in_progress when you start working on them, completed when done, or failed on errors. " +
      "Do NOT skip status transitions — always mark in_progress before completed so the UI shows progress. " +
      "Do NOT update tasks you haven't started working on. " +
      "Can also update title, description, and metadata if scope changes during execution.",
    input_schema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to update",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed"],
          description: "New status",
        },
        title: {
          type: "string",
          description: "Updated title (optional)",
        },
        description: {
          type: "string",
          description: "Updated description (optional)",
        },
        metadata: {
          type: "object",
          description: "Metadata to merge into existing metadata (optional)",
        },
      },
      required: ["taskId"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const taskId = (args.taskId as string) || "";
    const state = getTaskState(ctx.conversationId);
    const task = state.tasks[taskId];

    if (!task) {
      return {
        tool_use_id: toolUseId,
        content: `Task "${taskId}" not found`,
        is_error: true,
      };
    }

    const now = Date.now();

    if (args.status !== undefined) {
      task.status = args.status as TaskStatus;
      if (task.status === "completed") {
        task.completedAt = now;
      }
    }
    if (args.title !== undefined) {
      task.title = (args.title as string).trim();
    }
    if (args.description !== undefined) {
      task.description = (args.description as string).trim() || undefined;
    }
    if (args.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...(args.metadata as Record<string, unknown>) };
    }

    task.updatedAt = now;

    // Update plan file
    if (state.plan?.filePath) {
      writePlanFile(ctx.conversationId, state);
    }

    saveTaskState(ctx.conversationId, state);
    emitTaskState(ctx, state);

    return {
      tool_use_id: toolUseId,
      content: `Task [${taskId}] updated: status=${task.status}`,
    };
  },
};

// ── task_list ──

export const listTasksTool: ToolHandler = {
  definition: {
    name: "task_list",
    description:
      "List all tasks in the current plan with their status, dependencies, and progress summary. " +
      "Use to check overall progress, find the next unblocked task, or review the plan state. " +
      "Do NOT call this every round — the system message already includes task state. " +
      "Only call when you need the full list (e.g., after completing a task to find the next one).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },

  async execute(toolUseId: string, _args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const state = getTaskState(ctx.conversationId);

    if (!state.plan) {
      return { tool_use_id: toolUseId, content: "No active plan." };
    }

    const lines: string[] = [
      `Plan: ${state.plan.title}`,
      `Mode: ${state.mode}`,
    ];

    if (state.plan.summary) {
      lines.push(`Goal: ${state.plan.summary}`);
    }
    if (state.plan.filePath) {
      lines.push(`Plan file: ${state.plan.filePath}`);
    }

    lines.push(`Approved: ${state.plan.approved === null ? "pending" : state.plan.approved}`);
    lines.push("");

    const tasks = state.plan.taskIds.map((id) => state.tasks[id]).filter(Boolean);

    if (tasks.length === 0) {
      lines.push("No tasks yet.");
    } else {
      for (const task of tasks) {
        const icon = statusIcon(task.status);
        const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.map((d) => d.slice(0, 8)).join(", ")})` : "";
        lines.push(`${icon} [${task.id.slice(0, 8)}] ${task.title}${deps}`);
      }

      lines.push("");
      const completed = tasks.filter((t) => t.status === "completed").length;
      const inProgress = tasks.filter((t) => t.status === "in_progress").length;
      const failed = tasks.filter((t) => t.status === "failed").length;
      lines.push(
        `Progress: ${completed}/${tasks.length} completed` +
        (inProgress > 0 ? `, ${inProgress} in progress` : "") +
        (failed > 0 ? `, ${failed} failed` : ""),
      );
    }

    return { tool_use_id: toolUseId, content: lines.join("\n") };
  },
};

// ── task_get ──

export const getTaskTool: ToolHandler = {
  definition: {
    name: "task_get",
    description:
      "Get full details of a specific task including description, dependencies, metadata, and timestamps. " +
      "Use when you need the complete task description before starting work, or to check dependency status. " +
      "Do NOT call this for every task — the system message includes the current task's details. " +
      "Only needed when you want details of a task that isn't the current one.",
    input_schema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to retrieve",
        },
      },
      required: ["taskId"],
    },
  },

  async execute(toolUseId: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const taskId = (args.taskId as string) || "";
    const state = getTaskState(ctx.conversationId);
    const task = state.tasks[taskId];

    if (!task) {
      return {
        tool_use_id: toolUseId,
        content: `Task "${taskId}" not found`,
        is_error: true,
      };
    }

    const lines: string[] = [
      `Task: ${task.title}`,
      `ID: ${task.id}`,
      `Status: ${task.status}`,
    ];

    if (task.description) lines.push(`Description: ${task.description}`);
    if (task.parentId) lines.push(`Parent: ${task.parentId}`);
    if (task.dependsOn.length > 0) lines.push(`Depends on: ${task.dependsOn.join(", ")}`);
    if (task.activeLabel) lines.push(`Active label: ${task.activeLabel}`);
    if (task.metadata) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
    lines.push(`Created: ${new Date(task.createdAt).toISOString()}`);
    if (task.completedAt) lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);

    return { tool_use_id: toolUseId, content: lines.join("\n") };
  },
};

// ── Helpers ──

function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "completed": return "[x]";
    case "in_progress": return "[>]";
    case "failed": return "[!]";
    default: return "[ ]";
  }
}
