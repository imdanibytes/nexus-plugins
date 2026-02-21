import Anthropic from "@anthropic-ai/sdk";
import { ToolExecutor } from "./executor.js";
import type { ToolDefinition } from "./types.js";
import type { ToolFilter } from "../types.js";
import { getToolSettings } from "./settings.js";
import type { AgentMode } from "../tasks/types.js";
import { graphEngine } from "../graph/index.js";
import { delegateTool } from "./handlers/delegate.js";
import {
  setModeTool,
  approvePlanTool,
  createPlanTool,
  createTaskTool,
  updateTaskTool,
  listTasksTool,
  getTaskTool,
} from "./handlers/tasks.js";
import { createBatchCallTool } from "./handlers/batch-call.js";
import { fetchMcpToolHandlers } from "./handlers/remote.js";

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
// Delegated to the state graph engine. Each node declares which internal tools
// are visible and whether external (MCP) tools are accessible.

/** Filter definitions based on the current agent workflow mode. */
function applyModeFilter(defs: ToolDefinition[], mode?: AgentMode): ToolDefinition[] {
  if (!mode) return defs;

  const internalTools = graphEngine.getInternalTools(mode);
  const allowExternal = graphEngine.allowsExternalTools(mode);

  return defs.filter((d) => {
    if (graphEngine.internalToolNames.has(d.name)) {
      return internalTools.has(d.name);
    }
    // Non-internal = MCP or frontend tools
    return allowExternal;
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
  // batch_call must be registered after all other tools so it can reference them
  executor.register(createBatchCallTool(executor));

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
