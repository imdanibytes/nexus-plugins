import fs from "node:fs";
import path from "node:path";
import type { TaskState } from "./types.js";

const TASKS_DIR = "/data/tasks";
const PLANS_DIR = "/data/plans";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function filePath(conversationId: string): string {
  return path.join(TASKS_DIR, `tasks_${conversationId}.json`);
}

/** Path to a plan's markdown file. */
export function planFilePath(conversationId: string): string {
  return path.join(PLANS_DIR, `plan_${conversationId}.md`);
}

function emptyState(): TaskState {
  return { plan: null, tasks: {}, mode: "general" };
}

/** Load task state for a conversation. Returns empty state if none exists. */
export function getTaskState(conversationId: string): TaskState {
  const fp = filePath(conversationId);
  if (!fs.existsSync(fp)) return emptyState();
  try {
    const state = JSON.parse(fs.readFileSync(fp, "utf8")) as TaskState;
    // Backfill mode for states saved before mode was added
    if (!state.mode) state.mode = state.plan ? "execution" : "general";
    return state;
  } catch {
    return emptyState();
  }
}

/** Persist task state with atomic write (tmp → rename). */
export function saveTaskState(conversationId: string, state: TaskState): void {
  ensureDir(TASKS_DIR);
  const fp = filePath(conversationId);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, fp);
}

/** Write the plan as a markdown file the agent can reference. */
export function writePlanFile(conversationId: string, state: TaskState): string {
  ensureDir(PLANS_DIR);
  const fp = planFilePath(conversationId);
  const md = formatPlanMarkdown(state);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, md);
  fs.renameSync(tmp, fp);
  return fp;
}

/** Delete task state for a conversation. Returns true if a file was deleted. */
export function deleteTaskState(conversationId: string): boolean {
  const fp = filePath(conversationId);
  const pfp = planFilePath(conversationId);
  let deleted = false;
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    deleted = true;
  }
  if (fs.existsSync(pfp)) {
    fs.unlinkSync(pfp);
  }
  return deleted;
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "done";
    case "in_progress": return "in progress";
    case "failed": return "failed";
    default: return "pending";
  }
}

function formatPlanMarkdown(state: TaskState): string {
  const { plan, tasks, mode } = state;
  if (!plan) return "# No active plan\n";

  const lines: string[] = [`# ${plan.title}`, ""];

  if (plan.summary) {
    lines.push("## Goal", "", plan.summary, "");
  }

  const ordered = plan.taskIds.map((id) => tasks[id]).filter(Boolean);
  if (ordered.length > 0) {
    lines.push("## Tasks", "");
    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      const check = t.status === "completed" ? "x" : t.status === "in_progress" ? ">" : " ";
      const indent = t.parentId ? "  " : "";
      const deps = t.dependsOn.length > 0
        ? ` _(depends on: ${t.dependsOn.map((d) => d.slice(0, 8)).join(", ")})_`
        : "";
      lines.push(`${indent}- [${check}] **${t.title}** [${statusLabel(t.status)}]${deps}`);
      if (t.description) {
        lines.push(`${indent}  ${t.description}`);
      }
    }
    lines.push("");
  }

  const completed = ordered.filter((t) => t.status === "completed").length;
  lines.push("## Status", "");
  lines.push(`- **Mode:** ${mode}`);
  lines.push(`- **Progress:** ${completed}/${ordered.length} tasks completed`);
  lines.push(`- **Approved:** ${plan.approved === null ? "pending review" : plan.approved ? "yes" : "rejected"}`);
  lines.push("");

  return lines.join("\n");
}
