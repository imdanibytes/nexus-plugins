import type { StateGraphDef, StateNode, StateEdge, InterruptDef } from "./types.js";

// ── Nodes ──

const general: StateNode = {
  id: "general",
  description: "Default conversational mode. No active workflow.",
  instructions: [
    "You are in general mode. Respond conversationally to the user.",
    "If the user asks you to build, create, or implement something non-trivial, transition to discovery mode to gather requirements first.",
    "For simple questions or small tasks, stay in general mode and handle them directly.",
  ],
  internalTools: ["workflow_set_mode", "batch_call"],
  allowExternalTools: true,
  transitionHints: [
    "\u2192 discovery: When the user requests a non-trivial build/create/implement task",
    "\u2192 planning: When you already have enough context to design a solution directly",
  ],
};

const discovery: StateNode = {
  id: "discovery",
  description: "Gathering requirements and understanding the problem.",
  instructions: [
    "You are gathering requirements. Your job is to fully understand what needs to be built before planning.",
    "Ask focused, specific questions about scope, constraints, and success criteria.",
    "Do NOT write code, create files, or start implementation.",
    "Do NOT create a plan yet \u2014 you're still understanding the problem.",
    "When you have enough clarity to design a solution, transition to planning mode.",
  ],
  internalTools: ["workflow_set_mode"],
  allowExternalTools: false,
  transitionHints: [
    "\u2192 planning: When requirements are clear enough to design a solution",
    "\u2192 general: If the user abandons the request or it turns out to be trivial",
  ],
};

const planning: StateNode = {
  id: "planning",
  description: "Designing the solution and creating a task plan.",
  instructions: [
    "You are designing the solution. Use the delegate tool to consult architect/planner sub-agents.",
    "Create a plan with task_create_plan, then break it into tasks with task_create.",
    "Present the plan to the user for approval before proceeding.",
    "Do NOT execute tasks or write implementation code yet.",
    "The plan must be approved (task_approve_plan) before transitioning to execution.",
  ],
  internalTools: ["delegate", "task_create_plan", "task_create", "task_approve_plan", "workflow_set_mode"],
  allowExternalTools: false,
  transitionHints: [
    "\u2192 execution: When the plan is approved by the user",
    "\u2192 discovery: If the plan reveals missing requirements",
    "\u2192 general: If the user abandons the plan",
  ],
};

const execution: StateNode = {
  id: "execution",
  description: "Working through the approved plan, task by task.",
  instructions: [
    "You are executing the approved plan. Work through tasks in order, respecting dependencies.",
    "Mark each task as in_progress when you start it, and completed when done.",
    "If you encounter ambiguity not covered in the plan, pause and clarify with the user rather than guessing.",
    "Use delegate to consult specialist sub-agents (reviewer, security, tester) when appropriate.",
    "When all tasks are complete, transition to review mode.",
  ],
  internalTools: ["delegate", "batch_call", "task_update", "task_list", "task_get", "workflow_set_mode"],
  allowExternalTools: true,
  transitionHints: [
    "\u2192 review: When all tasks are completed",
    "\u2192 discovery: If a task reveals requirements that weren't captured in the plan",
  ],
};

const review: StateNode = {
  id: "review",
  description: "Reviewing completed work for correctness and quality.",
  instructions: [
    "All tasks are complete. Review the work before closing out.",
    "Use delegate with reviewer/security/tester roles to audit the implementation.",
    "Present findings to the user. If issues are found, create new tasks and return to execution.",
    "When the user is satisfied, transition back to general mode.",
  ],
  internalTools: ["delegate", "task_list", "task_get", "workflow_set_mode"],
  allowExternalTools: false,
  transitionHints: [
    "\u2192 execution: If review reveals issues that need fixing (create new tasks first)",
    "\u2192 general: When the user accepts the completed work",
  ],
};

// ── Edges ──

const edges: StateEdge[] = [
  // general
  { from: "general", to: "discovery" },
  { from: "general", to: "planning" },  // shortcut when discovery is unnecessary

  // discovery
  { from: "discovery", to: "planning" },
  { from: "discovery", to: "general" },

  // planning
  { from: "planning", to: "discovery" },
  { from: "planning", to: "general" },
  {
    from: "planning",
    to: "execution",
    guard: (state) => {
      if (!state.plan) {
        return { ok: false, reason: "Cannot enter execution mode without a plan. Create one with task_create_plan first." };
      }
      if (state.plan.approved !== true) {
        return { ok: false, reason: "Cannot enter execution mode \u2014 plan must be approved first. Use task_approve_plan." };
      }
      return { ok: true };
    },
  },

  // execution
  { from: "execution", to: "review" },
  { from: "execution", to: "discovery" },

  // review
  { from: "review", to: "execution" },
  { from: "review", to: "general" },
];

// ── Interrupts ──

const interrupts: InterruptDef[] = [
  {
    type: "plan_approval",
    modes: ["planning"],
    event: "interrupt_plan_approval",
  },
  {
    type: "user_clarification",
    modes: ["execution"],
    event: "interrupt_clarification",
  },
];

// ── Export ──

export const AGENT_GRAPH: StateGraphDef = {
  nodes: [general, discovery, planning, execution, review],
  edges,
  interrupts,
};
