import Anthropic from "@anthropic-ai/sdk";
import { ToolExecutor } from "./tools/executor.js";
import type { ToolDefinition } from "./tools/types.js";
import type { ToolFilter } from "./types.js";
import { getToolSettings } from "./tool-settings.js";
import type { AgentMode } from "./tasks/types.js";
import { delegateTool } from "./tools/handlers/delegate.js";
import {
  setModeTool,
  approvePlanTool,
  createPlanTool,
  createTaskTool,
  updateTaskTool,
  listTasksTool,
  getTaskTool,
} from "./tools/handlers/tasks.js";
import { fetchMcpToolHandlers } from "./tools/handlers/remote.js";

export interface ToolRegistry {
  executor: ToolExecutor;
  definitions: ToolDefinition[];
  anthropicTools: Anthropic.Tool[];
  wireName(name: string): string;
  origName(name: string): string;
}

/** Match a tool name against a glob pattern (supports * and ? wildcards). */
function matchGlob(pattern: string, name: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
  );
  return regex.test(name);
}

/** Apply tool filters (global + agent-level) to a list of tool definitions. */
function applyToolFilters(
  defs: ToolDefinition[],
  globalFilter?: ToolFilter,
  agentFilter?: ToolFilter,
): ToolDefinition[] {
  let result = defs;

  if (globalFilter) {
    if (globalFilter.mode === "allow") {
      result = result.filter((d) =>
        globalFilter.tools.some((t) => matchGlob(t, d.name)),
      );
    } else {
      result = result.filter(
        (d) => !globalFilter.tools.some((t) => matchGlob(t, d.name)),
      );
    }
  }

  if (agentFilter) {
    if (agentFilter.mode === "allow") {
      result = result.filter((d) =>
        agentFilter.tools.some((t) => matchGlob(t, d.name)),
      );
    } else {
      result = result.filter(
        (d) => !agentFilter.tools.some((t) => matchGlob(t, d.name)),
      );
    }
  }

  return result;
}

// ── Mode-based tool visibility ──
// Internal tool names allowed per mode. Tools not listed are hidden from the model.
// The executor still registers everything (so calls aren't rejected), but the model
// only sees tools appropriate for its current mode.

const INTERNAL_TOOL_NAMES = new Set([
  "delegate",
  "workflow_set_mode",
  "task_approve_plan",
  "task_create_plan",
  "task_create",
  "task_update",
  "task_list",
  "task_get",
]);

const MODE_TOOLS: Record<AgentMode, { internal: Set<string>; allowMcp: boolean }> = {
  general: {
    internal: new Set(["workflow_set_mode"]),
    allowMcp: true,
  },
  discovery: {
    internal: new Set(["workflow_set_mode"]),
    allowMcp: false,
  },
  planning: {
    internal: new Set(["delegate", "task_create_plan", "task_create", "task_approve_plan", "workflow_set_mode"]),
    allowMcp: false,
  },
  execution: {
    internal: new Set(["delegate", "task_update", "task_list", "task_get", "workflow_set_mode"]),
    allowMcp: true,
  },
  review: {
    internal: new Set(["delegate", "task_list", "task_get", "workflow_set_mode"]),
    allowMcp: false,
  },
};

/** Filter definitions based on the current agent workflow mode. */
function applyModeFilter(defs: ToolDefinition[], mode?: AgentMode): ToolDefinition[] {
  if (!mode) return defs;

  const config = MODE_TOOLS[mode];
  return defs.filter((d) => {
    if (INTERNAL_TOOL_NAMES.has(d.name)) {
      return config.internal.has(d.name);
    }
    // Non-internal = MCP or frontend tools
    return config.allowMcp;
  });
}

/**
 * Build a ToolRegistry for a turn.
 *
 * The executor is rebuilt each call. This is cheap because `fetchMcpToolHandlers()`
 * has its own 30s TTL cache — the network call only fires when the cache expires.
 * Rebuilding per-turn keeps the executor coherent with MCP tool changes without
 * needing a separate invalidation mechanism.
 */
export async function getToolRegistry(
  globalFilter?: ToolFilter,
  agentFilter?: ToolFilter,
  frontendTools?: ToolDefinition[],
  agentMode?: AgentMode,
): Promise<ToolRegistry> {
  const executor = new ToolExecutor();
  executor.register(delegateTool);
  executor.register(setModeTool);
  executor.register(approvePlanTool);
  executor.register(createPlanTool);
  executor.register(createTaskTool);
  executor.register(updateTaskTool);
  executor.register(listTasksTool);
  executor.register(getTaskTool);
  executor.registerAll(await fetchMcpToolHandlers());

  // Apply global + agent-level filters. Frontend tools bypass server-side
  // filters (they're defined by the client and shouldn't be subject to admin deny-lists).
  // NOTE: uiHiddenPatterns is a UI-only display filter (applied in useChatStream.ts),
  // NOT a model-level filter. Tools like _nexus_set_title must be visible to the LLM.
  const toolSettings = await getToolSettings();
  let serverDefs = applyToolFilters(executor.definitions(), globalFilter, agentFilter);

  // Apply mode-based filtering — hides tools the agent shouldn't use in its current workflow phase
  serverDefs = applyModeFilter(serverDefs, agentMode);
  const filtered: ToolDefinition[] = [...serverDefs, ...(frontendTools ?? [])];

  // LLM APIs require tool names to match ^[a-zA-Z0-9_-]+$ — sanitize dots
  const toWire = new Map<string, string>();
  const toOrig = new Map<string, string>();

  for (const d of filtered) {
    if (d.name.includes(".")) {
      const sanitized = d.name.replace(/\./g, "__");
      toWire.set(d.name, sanitized);
      toOrig.set(sanitized, d.name);
    }
  }

  const anthropicTools: Anthropic.Tool[] = filtered.map((d) => ({
    name: toWire.get(d.name) ?? d.name,
    description: d.description,
    input_schema: d.input_schema as Anthropic.Tool["input_schema"],
  }));

  return {
    executor,
    definitions: filtered,
    anthropicTools,
    wireName: (name: string) => toWire.get(name) ?? name,
    origName: (name: string) => toOrig.get(name) ?? name,
  };
}
