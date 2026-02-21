export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type AgentMode = "general" | "discovery" | "planning" | "execution" | "review";

export interface Task {
  id: string;
  /** Brief imperative title (e.g., "Implement auth endpoints") */
  title: string;
  /** Detailed description of what needs to be done */
  description?: string;
  status: TaskStatus;
  /** Parent task ID for subtask grouping (display-level hierarchy) */
  parentId?: string;
  /** IDs of tasks that must complete before this one can start */
  dependsOn: string[];
  /** Present continuous form shown during execution (e.g., "Implementing auth endpoints") */
  activeLabel?: string;
  /** Freeform metadata the agent can attach */
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  /** Conversation this plan belongs to */
  conversationId: string;
  /** Short title for the plan */
  title: string;
  /** Summary of the overall goal and approach */
  summary?: string;
  /** Ordered list of task IDs */
  taskIds: string[];
  /** null = not yet reviewed, true = approved, false = rejected */
  approved: boolean | null;
  /** Path to the plan's markdown file (for agent reference) */
  filePath?: string;
  createdAt: number;
  updatedAt: number;
}

/** Full task state for a conversation */
export interface TaskState {
  plan: Plan | null;
  tasks: Record<string, Task>;
  /** Current workflow mode — governs agent behavior via system message */
  mode: AgentMode;
}
