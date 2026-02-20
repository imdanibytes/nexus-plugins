import { useEffect, type FC } from "react";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  ListTodoIcon,
} from "lucide-react";
import { Button } from "@heroui/react";
import { cn } from "@imdanibytes/nexus-ui";
import { useTaskStore } from "@/stores/taskStore.js";
import { useThreadListStore } from "@/stores/threadListStore.js";
import { fetchTaskState } from "@/api/client.js";
import type { Task, TaskStatus, AgentMode } from "@/api/client.js";

// ── Mode badge ──

const MODE_CONFIG: Record<AgentMode, { label: string; color: string }> = {
  general: { label: "General", color: "text-default-500 bg-default-100/40" },
  discovery: { label: "Discovery", color: "text-amber-400 bg-amber-400/10" },
  planning: { label: "Planning", color: "text-blue-400 bg-blue-400/10" },
  execution: { label: "Executing", color: "text-emerald-400 bg-emerald-400/10" },
  review: { label: "Review", color: "text-purple-400 bg-purple-400/10" },
};

const ModeBadge: FC<{ mode: AgentMode }> = ({ mode }) => {
  const config = MODE_CONFIG[mode];
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", config.color)}>
      {config.label}
    </span>
  );
};

// ── Status icon mapping ──

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2Icon size={14} className="text-emerald-500 shrink-0" />;
    case "in_progress":
      return <CircleDotIcon size={14} className="text-blue-400 animate-pulse shrink-0" />;
    case "failed":
      return <XCircleIcon size={14} className="text-red-400 shrink-0" />;
    default:
      return <CircleIcon size={14} className="text-default-400/40 shrink-0" />;
  }
}

// ── Single task row ──

const TaskRow: FC<{ task: Task; isSubtask?: boolean; isCurrent?: boolean }> = ({ task, isSubtask, isCurrent }) => (
  <div
    className={cn(
      "flex items-start gap-2 py-1 px-1 rounded text-xs",
      isSubtask && "ml-4",
      isCurrent && "bg-blue-500/5 border-l-2 border-blue-400 pl-2",
      task.status === "completed" && "opacity-60",
    )}
  >
    <StatusIcon status={task.status} />
    <span
      className={cn(
        "leading-tight",
        task.status === "completed" && "line-through text-default-500",
        task.status === "in_progress" && "text-foreground font-medium",
      )}
    >
      {task.status === "in_progress" && task.activeLabel
        ? task.activeLabel
        : task.title}
    </span>
  </div>
);

// ── Progress bar ──

const ProgressBar: FC<{ completed: number; total: number }> = ({ completed, total }) => {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[10px] text-default-500">
      <div className="flex-1 h-1 bg-default-100/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>{completed}/{total}</span>
    </div>
  );
};

// ── Approval badge ──

const ApprovalBadge: FC<{ approved: boolean | null }> = ({ approved }) => {
  if (approved === null) {
    return (
      <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full font-medium">
        Awaiting approval
      </span>
    );
  }
  if (approved) {
    return (
      <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full font-medium">
        Approved
      </span>
    );
  }
  return (
    <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full font-medium">
      Rejected
    </span>
  );
};

// ── Main panel ──

export const TaskPanel: FC = () => {
  const activeThreadId = useThreadListStore((s) => s.activeThreadId);
  const taskState = useTaskStore((s) =>
    activeThreadId ? s.states[activeThreadId] : undefined,
  );
  const panelOpen = useTaskStore((s) => s.panelOpen);
  const setPanelOpen = useTaskStore((s) => s.setPanelOpen);

  // Hydrate task state on conversation switch
  useEffect(() => {
    if (!activeThreadId) return;
    fetchTaskState(activeThreadId).then((state) => {
      if (state.plan || state.mode !== "general") {
        useTaskStore.getState().setTaskState(activeThreadId, state);
      }
    });
  }, [activeThreadId]);

  // Don't render if no plan and in general mode
  if (!taskState?.plan && (!taskState || taskState.mode === "general")) return null;

  const mode = taskState?.mode ?? "general";
  const plan = taskState?.plan;
  const tasks = taskState?.tasks ?? {};

  const orderedTasks = plan
    ? plan.taskIds.map((id) => tasks[id]).filter(Boolean)
    : [];

  const topLevelTasks = orderedTasks.filter((t) => !t.parentId);
  const subtasksOf = (parentId: string) =>
    orderedTasks.filter((t) => t.parentId === parentId);

  const completed = orderedTasks.filter((t) => t.status === "completed").length;
  const total = orderedTasks.length;

  // Find current task
  const currentTask = orderedTasks.find((t) => t.status === "in_progress")
    || orderedTasks.find((t) =>
      t.status === "pending" && t.dependsOn.every(
        (dep) => tasks[dep]?.status === "completed",
      ),
    );

  // Collapsed state — just show a toggle button
  if (!panelOpen) {
    return (
      <div className="border-l border-default-200 dark:border-default-200/50 flex flex-col items-center pt-2 px-1 bg-default-100 dark:bg-default-50/40 backdrop-blur-xl">
        <Button
          variant="light"
          size="sm"
          onPress={() => setPanelOpen(true)}
          isIconOnly
          className="h-7 w-7 min-w-7"
          aria-label="Show tasks"
        >
          <ListTodoIcon size={14} />
        </Button>
        <ModeBadge mode={mode} />
        {total > 0 && (
          <span className="text-[10px] text-default-500 mt-1">
            {completed}/{total}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-72 border-l border-default-200 dark:border-default-200/50 flex flex-col h-full bg-default-100 dark:bg-default-50/40 backdrop-blur-xl shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-default-200/50">
        <div className="flex items-center gap-2 min-w-0">
          <ListTodoIcon size={14} className="text-default-500 shrink-0" />
          <span className="text-xs font-medium truncate">{plan?.title ?? "Workflow"}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ModeBadge mode={mode} />
          <Button
            variant="light"
            size="sm"
            onPress={() => setPanelOpen(false)}
            isIconOnly
            className="h-6 w-6 min-w-6 p-0"
          >
            <ChevronRightIcon size={12} />
          </Button>
        </div>
      </div>

      {/* Summary + approval */}
      {plan && (
        <div className="px-3 py-2 border-b border-default-200/50 space-y-1.5">
          {plan.summary && (
            <div className="text-[11px] text-default-500 leading-relaxed">
              {plan.summary}
            </div>
          )}
          <ApprovalBadge approved={plan.approved} />
        </div>
      )}

      {/* Progress */}
      {total > 0 && (
        <div className="px-3 py-2">
          <ProgressBar completed={completed} total={total} />
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {topLevelTasks.map((task) => (
          <div key={task.id}>
            <TaskRow task={task} isCurrent={task === currentTask} />
            {subtasksOf(task.id).map((sub) => (
              <TaskRow key={sub.id} task={sub} isSubtask isCurrent={sub === currentTask} />
            ))}
          </div>
        ))}
        {plan && orderedTasks.length === 0 && (
          <div className="text-[11px] text-default-500 text-center py-4">
            No tasks yet
          </div>
        )}
        {!plan && mode !== "general" && (
          <div className="text-[11px] text-default-500 text-center py-4">
            {mode === "discovery" ? "Gathering requirements..." : "No plan created yet"}
          </div>
        )}
      </div>
    </div>
  );
};
