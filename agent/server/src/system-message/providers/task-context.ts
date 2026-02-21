import type { SystemMessageProvider, SystemMessageContext } from "../types.js";
import { getTaskState } from "../../tasks/storage.js";
import type { TaskState, TaskStatus } from "../../tasks/types.js";
import { graphEngine } from "../../graph/index.js";

export const taskContextProvider: SystemMessageProvider = {
  name: "task-context",
  timeoutMs: 100,

  async provide(ctx: SystemMessageContext): Promise<string | null> {
    const state = getTaskState(ctx.conversationId);
    return formatAgentState(state);
  },
};

// ── Formatter ──

function formatAgentState(state: TaskState): string {
  const { plan, tasks, mode } = state;
  const rules = graphEngine.formatModeRules(mode);
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
