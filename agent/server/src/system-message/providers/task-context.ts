import type { SystemMessageProvider, SystemMessageContext } from "../types.js";
import { getTaskState } from "../../tasks/storage.js";
import type { TaskState, AgentMode, Task, TaskStatus } from "../../tasks/types.js";

export const taskContextProvider: SystemMessageProvider = {
  name: "task-context",
  timeoutMs: 100,

  async provide(ctx: SystemMessageContext): Promise<string | null> {
    const state = getTaskState(ctx.conversationId);

    // In general mode with no plan, nothing to inject
    if (state.mode === "general" && !state.plan) return null;

    return formatAgentState(state);
  },
};

// ── Mode rules ──

interface ModeRules {
  description: string;
  instructions: string[];
  transitions: string[];
}

const MODE_RULES: Record<AgentMode, ModeRules> = {
  general: {
    description: "Default conversational mode. No active workflow.",
    instructions: [
      "You are in general mode. Respond conversationally to the user.",
      "If the user asks you to build, create, or implement something non-trivial, transition to discovery mode to gather requirements first.",
      "For simple questions or small tasks, stay in general mode and handle them directly.",
    ],
    transitions: [
      "→ discovery: When the user requests a non-trivial build/create/implement task",
    ],
  },

  discovery: {
    description: "Gathering requirements and understanding the problem.",
    instructions: [
      "You are gathering requirements. Your job is to fully understand what needs to be built before planning.",
      "Ask focused, specific questions about scope, constraints, and success criteria.",
      "Do NOT write code, create files, or start implementation.",
      "Do NOT create a plan yet — you're still understanding the problem.",
      "When you have enough clarity to design a solution, transition to planning mode.",
    ],
    transitions: [
      "→ planning: When requirements are clear enough to design a solution",
      "→ general: If the user abandons the request or it turns out to be trivial",
    ],
  },

  planning: {
    description: "Designing the solution and creating a task plan.",
    instructions: [
      "You are designing the solution. Use the delegate tool to consult architect/planner sub-agents.",
      "Create a plan with task_create_plan, then break it into tasks with task_create.",
      "Present the plan to the user for approval before proceeding.",
      "Do NOT execute tasks or write implementation code yet.",
      "The plan must be approved (task_approve_plan) before transitioning to execution.",
    ],
    transitions: [
      "→ execution: When the plan is approved by the user",
      "→ discovery: If the plan reveals missing requirements",
      "→ general: If the user abandons the plan",
    ],
  },

  execution: {
    description: "Working through the approved plan, task by task.",
    instructions: [
      "You are executing the approved plan. Work through tasks in order, respecting dependencies.",
      "Mark each task as in_progress when you start it, and completed when done.",
      "If you encounter ambiguity not covered in the plan, pause and clarify with the user rather than guessing.",
      "Use delegate to consult specialist sub-agents (reviewer, security, tester) when appropriate.",
      "When all tasks are complete, transition to review mode.",
    ],
    transitions: [
      "→ review: When all tasks are completed",
      "→ discovery: If a task reveals requirements that weren't captured in the plan",
    ],
  },

  review: {
    description: "Reviewing completed work for correctness and quality.",
    instructions: [
      "All tasks are complete. Review the work before closing out.",
      "Use delegate with reviewer/security/tester roles to audit the implementation.",
      "Present findings to the user. If issues are found, create new tasks and return to execution.",
      "When the user is satisfied, transition back to general mode.",
    ],
    transitions: [
      "→ execution: If review reveals issues that need fixing (create new tasks first)",
      "→ general: When the user accepts the completed work",
    ],
  },
};

// ── Formatter ──

function formatAgentState(state: TaskState): string {
  const { plan, tasks, mode } = state;
  const rules = MODE_RULES[mode];
  const lines: string[] = ["<agent_state>"];

  // Mode + rules
  lines.push(`mode: ${mode}`);
  lines.push(`description: ${rules.description}`);
  lines.push("");
  lines.push("Rules:");
  for (const rule of rules.instructions) {
    lines.push(`- ${rule}`);
  }
  lines.push("");
  lines.push("Transitions:");
  for (const t of rules.transitions) {
    lines.push(`  ${t}`);
  }

  // Plan details (if one exists)
  if (plan) {
    lines.push("");
    lines.push(`plan: ${plan.title}`);
    if (plan.filePath) {
      lines.push(`plan_file: ${plan.filePath}`);
    }
    if (plan.summary) {
      lines.push(`goal: ${plan.summary}`);
    }
    lines.push(`approved: ${plan.approved === null ? "pending review" : plan.approved ? "yes" : "rejected"}`);

    if (plan.approved === false) {
      lines.push("⚠ Plan was rejected — revise before proceeding.");
    }

    // Task summary
    const ordered = plan.taskIds.map((id) => tasks[id]).filter(Boolean);
    if (ordered.length > 0) {
      // Find current task (first in_progress, or first pending if none in progress)
      const currentTask = ordered.find((t) => t.status === "in_progress")
        || ordered.find((t) => t.status === "pending" && t.dependsOn.every(
          (dep) => tasks[dep]?.status === "completed",
        ));

      if (currentTask) {
        lines.push("");
        lines.push(`current_task: [${currentTask.id.slice(0, 8)}] ${currentTask.title}`);
        if (currentTask.description) {
          lines.push(`task_detail: ${currentTask.description}`);
        }
        if (currentTask.dependsOn.length > 0) {
          const depStatus = currentTask.dependsOn.map((d) => {
            const dep = tasks[d];
            return dep ? `${dep.title} (${dep.status})` : d;
          });
          lines.push(`depends_on: ${depStatus.join(", ")}`);
        }
      }

      // Compact task list
      lines.push("");
      lines.push("tasks:");
      for (const task of ordered) {
        const icon = statusIcon(task.status);
        const marker = task === currentTask ? " ← current" : "";
        const indent = task.parentId ? "    " : "  ";
        lines.push(`${indent}${icon} [${task.id.slice(0, 8)}] ${task.title}${marker}`);
      }

      // Progress stats
      const completed = ordered.filter((t) => t.status === "completed").length;
      const inProgress = ordered.filter((t) => t.status === "in_progress").length;
      const failed = ordered.filter((t) => t.status === "failed").length;
      lines.push("");
      lines.push(
        `progress: ${completed}/${ordered.length} completed` +
        (inProgress > 0 ? `, ${inProgress} in progress` : "") +
        (failed > 0 ? `, ${failed} failed` : ""),
      );
    }
  }

  lines.push("</agent_state>");
  return lines.join("\n");
}

function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "completed": return "[x]";
    case "in_progress": return "[>]";
    case "failed": return "[!]";
    default: return "[ ]";
  }
}
