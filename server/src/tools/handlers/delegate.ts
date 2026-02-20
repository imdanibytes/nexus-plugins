import type { ToolHandler, ToolResult, ToolContext } from "../types.js";
import { EventType } from "../../ag-ui-types.js";
import { runSubAgent, type SubAgentProgress } from "../../sub-agent/runner.js";
import { getRole } from "../../sub-agent/roles.js";
import { getModelTier } from "../../model-tiers.js";
import { getAgent } from "../../agents.js";
import { getProvider } from "../../providers.js";
import { createLlmClient } from "../../client-factory.js";
import type { ModelTierName } from "../../types.js";

/**
 * Resolve an LLM client + model from a tier name.
 * Returns null if the tier isn't configured or the agent/provider is missing.
 */
async function resolveFromTier(tierName: ModelTierName) {
  const agentId = getModelTier(tierName);
  if (!agentId) return null;

  const agent = getAgent(agentId);
  if (!agent) return null;

  const provider = await getProvider(agent.providerId);
  if (!provider) return null;

  const client = await createLlmClient(provider);
  return {
    client,
    model: agent.model,
    maxTokens: agent.maxTokens ?? 8192,
    temperature: agent.temperature,
    agentName: agent.name,
  };
}

export const delegateTool: ToolHandler = {
  definition: {
    name: "delegate",
    description:
      "Delegate work to a specialized sub-agent that runs with its own system prompt, scoped context, and fresh context window. " +
      "Use when a task benefits from focused expertise: architecture design, code review, security audit, test planning, or any specialized reasoning. " +
      "Do NOT use for simple questions you can answer directly — delegation has latency and token cost. " +
      "The sub-agent has NO access to conversation history; pass all relevant context (file contents, requirements, code) via the context parameter. " +
      "Built-in roles: architect (designs systems), planner (decomposes into tasks), reviewer (code quality), security (vulnerability audit), tester (test plans). " +
      "Each role maps to a model tier (powerful/balanced/fast) — configure tiers in Settings → Agents. " +
      "Use role='custom' with systemPrompt for anything else. Optionally specify tier to override the default. " +
      "Returns the sub-agent's text output for your review.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description:
            "Built-in role: 'architect' (designs systems, powerful tier), 'planner' (decomposes into tasks, balanced tier), " +
            "'reviewer' (code review, powerful tier), 'security' (vulnerability audit, powerful tier), 'tester' (test plans, balanced tier). " +
            "Use 'custom' with systemPrompt for anything else.",
        },
        goal: {
          type: "string",
          description: "What the sub-agent should accomplish — be specific",
        },
        context: {
          type: "string",
          description:
            "Relevant context: file contents, requirements, code snippets, etc. " +
            "The sub-agent only sees this and the goal — nothing else.",
        },
        systemPrompt: {
          type: "string",
          description: "Custom system prompt (used when role is 'custom')",
        },
        tier: {
          type: "string",
          enum: ["fast", "balanced", "powerful"],
          description:
            "Override the model tier for this delegation. By default, the role's tier is used " +
            "(architect/reviewer/security → powerful, planner/tester → balanced). " +
            "Use 'fast' for simple tasks like find/replace or formatting.",
        },
        maxRounds: {
          type: "number",
          description: "Max tool-use rounds for the sub-agent (default: from role template)",
        },
      },
      required: ["role", "goal"],
    },
  },

  async execute(
    toolUseId: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const role = (args.role as string) || "planner";
    const goal = (args.goal as string) || "";
    const context = (args.context as string) || "";
    const customPrompt = (args.systemPrompt as string) || "";
    const tierOverride = args.tier as ModelTierName | undefined;
    const maxRoundsOverride = args.maxRounds as number | undefined;

    if (!goal) {
      return { tool_use_id: toolUseId, content: "No goal provided", is_error: true };
    }

    // Resolve role template
    const template = role === "custom" ? null : getRole(role);
    const systemPrompt = template?.systemPrompt ?? customPrompt;
    const maxRounds = maxRoundsOverride ?? template?.maxRounds ?? 3;

    if (!systemPrompt) {
      return {
        tool_use_id: toolUseId,
        content: `Unknown role "${role}" and no custom systemPrompt provided. Available roles: architect, planner, reviewer, security, tester, custom`,
        is_error: true,
      };
    }

    // Resolve LLM config: tier override → role's default tier → parent agent's config
    const effectiveTier = tierOverride ?? template?.tier;
    const tierConfig = effectiveTier ? await resolveFromTier(effectiveTier) : null;

    const client = tierConfig?.client ?? ctx.client;
    const model = tierConfig?.model ?? ctx.model;
    const maxTokens = tierConfig?.maxTokens ?? ctx.maxTokens ?? 8192;
    const temperature = tierConfig?.temperature ?? ctx.temperature;

    if (!client || !model) {
      return {
        tool_use_id: toolUseId,
        content: effectiveTier
          ? `Tier "${effectiveTier}" is not configured (no agent assigned). Configure tiers in Settings → Agents.`
          : "LLM client not available for delegation",
        is_error: true,
      };
    }

    // Build scoped messages — just the goal + context
    const userContent = context
      ? `${goal}\n\n---\n\nContext:\n${context}`
      : goal;

    // Notify UI that a sub-agent is starting
    const tierLabel = tierConfig
      ? `${effectiveTier} tier (${tierConfig.agentName})`
      : "parent config";

    ctx.sse.writeEvent(EventType.CUSTOM, {
      name: "sub_agent_started",
      value: { role, goal: goal.slice(0, 200), tier: effectiveTier, model },
    });

    console.log(
      `[delegate] role=${role} tier=${effectiveTier ?? "none"} model=${model} ` +
      `via=${tierLabel} maxRounds=${maxRounds} goal="${goal.slice(0, 80)}..."`,
    );

    try {
      const result = await runSubAgent({
        client,
        model,
        maxTokens,
        temperature,
        systemPrompt,
        messages: [{ role: "user", content: userContent }],
        maxRounds,
        signal: ctx.signal,
        onProgress: (event: SubAgentProgress) => {
          ctx.sse.writeEvent(EventType.CUSTOM, {
            name: "sub_agent_progress",
            value: event,
          });
        },
      });

      // Notify UI that the sub-agent is done
      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "sub_agent_complete",
        value: {
          role,
          tier: effectiveTier,
          model,
          rounds: result.rounds,
          tokenUsage: result.tokenUsage,
          toolCallCount: result.toolCalls.length,
        },
      });

      console.log(
        `[delegate] complete role=${role} tier=${effectiveTier ?? "none"} ` +
        `rounds=${result.rounds} tokens=${result.tokenUsage.input}+${result.tokenUsage.output} ` +
        `tools=${result.toolCalls.length}`,
      );

      return {
        tool_use_id: toolUseId,
        content: result.text || "(sub-agent produced no text output)",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[delegate] error: ${message}`);

      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "sub_agent_complete",
        value: { role, tier: effectiveTier, error: message },
      });

      return {
        tool_use_id: toolUseId,
        content: `Sub-agent failed: ${message}`,
        is_error: true,
      };
    }
  },
};
