import type { TurnStrategyContext, TurnStrategyResult, RoundLoopCallbacks } from "./types.js";
import type { MessagePart } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PendingToolCall, ResolvedToolResult } from "../ag-ui-types.js";
import { runRound } from "../round-runner.js";
import { resolveThinkingConfig, supportsNativeThinking } from "../thinking.js";
import { resolvePrice, calculateCost } from "../compaction/pricing.js";
import { truncateOldToolResults } from "../compaction/pipeline.js";
import { checkLoopGuard, createLoopGuardState, updateLoopGuard } from "../mechanics/loop-guard.js";
import { getTaskState } from "../tasks/storage.js";
import { EventType } from "../ag-ui-types.js";

/**
 * Execute the round loop with optional after-round callbacks.
 *
 * This is the core while loop extracted from agent.ts. A single insertion
 * point (the afterRound callback) enables strategies to inject quality
 * passes between rounds without duplicating loop mechanics.
 */
export async function executeRoundLoop(
  ctx: TurnStrategyContext,
  callbacks?: RoundLoopCallbacks,
): Promise<TurnStrategyResult> {
  let round = 0;
  const allAssistantParts: MessagePart[] = [];
  let turnResult: TurnStrategyResult["turnResult"] = {};
  const loopGuard = createLoopGuardState();
  let registry: ToolRegistry = ctx.toolRegistry;
  let lastMode = getTaskState(ctx.conversationId).mode;

  // Resolve thinking configuration for this turn
  const thinkingConfig = resolveThinkingConfig(ctx.config);
  const usePromptedCoT = !thinkingConfig
    && ctx.config.agent?.thinking?.mode !== "disabled"
    && (ctx.config.agent?.thinking?.mode === "prompted"
      || (ctx.config.agent?.thinking?.mode === "auto"
        && !supportsNativeThinking(ctx.config.model, ctx.config.provider?.type)));

  const thinkingStrategy = thinkingConfig
    ? "native"
    : usePromptedCoT
      ? "prompted"
      : "none";

  if (thinkingStrategy !== "none") {
    console.log(
      `[agent] thinking=${thinkingStrategy}` +
        (thinkingConfig?.type === "enabled" ? ` budget=${thinkingConfig.budget_tokens}` : ""),
    );
    ctx.sse.writeEvent(EventType.CUSTOM, {
      name: "thinking_config",
      value: {
        strategy: thinkingStrategy,
        ...(thinkingConfig?.type === "enabled" ? { budgetTokens: thinkingConfig.budget_tokens } : {}),
      },
    });
  }

  while (round < ctx.maxRounds) {
    if (ctx.signal.aborted) break;
    round++;

    const roundSpan = ctx.turnSpan.span(`round:${round}`, { round });

    // Rebuild tool registry if the agent mode changed mid-turn
    const currentMode = getTaskState(ctx.conversationId).mode;
    if (currentMode !== lastMode) {
      lastMode = currentMode;
      registry = await ctx.rebuildToolRegistry();
    }

    // Build system message fresh each round (token usage may have changed)
    const smSpan = roundSpan.span("system_message");
    const systemMessage = await ctx.systemMessageBuilder.build(
      {
        conversationId: ctx.conversationId,
        conversation: ctx.conversation,
        toolNames: registry.definitions.map((d) => registry.wireName(d.name)),
        settings: ctx.settings,
        tokenUsage: ctx.conversation.lastTokenUsage
          ? {
              input: ctx.conversation.lastTokenUsage.inputTokens,
              output: ctx.conversation.lastTokenUsage.outputTokens,
              limit: ctx.contextWindow,
            }
          : undefined,
        agent: ctx.config.agent ?? null,
        wireMessages: ctx.wireMessages,
      },
      smSpan,
    );
    smSpan.end();

    const result = await runRound({
      client: ctx.config.client,
      model: ctx.config.model,
      maxTokens: ctx.config.maxTokens,
      temperature: ctx.config.temperature,
      topP: ctx.config.topP,
      systemMessage,
      apiMessages: ctx.apiMessages,
      toolRegistry: registry,
      toolCtx: ctx.toolCtx,
      messageId: ctx.messageId,
      signal: ctx.signal,
      sse: ctx.sse,
      roundNumber: round,
      parentSpan: roundSpan,
      thinking: thinkingConfig,
      extractPromptedThinking: usePromptedCoT,
    });

    allAssistantParts.push(...result.assistantParts);

    // Update token tracking
    if (result.tokenUsage) {
      ctx.conversation.lastTokenUsage = {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        timestamp: Date.now(),
      };

      const pricing = resolvePrice(ctx.config.model, ctx.config.provider);
      const turnCost = calculateCost(
        result.tokenUsage.inputTokens,
        result.tokenUsage.outputTokens,
        pricing,
      );

      if (!ctx.conversation.usage) {
        ctx.conversation.usage = {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: 0,
          contextTokens: 0,
          contextWindow: 0,
        };
      }
      ctx.conversation.usage.totalInputTokens += result.tokenUsage.inputTokens;
      ctx.conversation.usage.totalOutputTokens += result.tokenUsage.outputTokens;
      ctx.conversation.usage.totalCost += turnCost;
      ctx.conversation.usage.contextTokens = result.tokenUsage.inputTokens;
      ctx.conversation.usage.contextWindow = ctx.contextWindow;

      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "usage",
        value: ctx.conversation.usage,
      });
    }

    roundSpan.end();

    // ── Loop guard ──
    const hadText = result.assistantParts.some(
      (p) => p.type === "text" && (p as { type: "text"; text: string }).text?.trim(),
    );
    const roundToolNames = result.assistantParts
      .filter((p) => p.type === "tool-call")
      .map((p) => (p as { type: "tool-call"; name: string }).name);
    updateLoopGuard(loopGuard, hadText, roundToolNames);

    const guard = checkLoopGuard(loopGuard);
    if (guard.action === "break") {
      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "loop_detected",
        value: { rounds: round, reason: guard.reason },
      });
      console.log(`[loop-guard] breaking after ${round} rounds: ${guard.reason}`);
      break;
    }

    // Continue the tool loop or break
    if (result.stopReason === "tool_use" && result.newApiMessages) {
      // Inject nudge message if loop guard says so
      if (guard.action === "nudge" && guard.message) {
        ctx.apiMessages.push({ role: "user", content: guard.message });
        ctx.sse.writeEvent(EventType.CUSTOM, {
          name: "loop_warning",
          value: { rounds: round, reason: guard.reason },
        });
        console.log(`[loop-guard] nudge at round ${round}: ${guard.reason}`);
      }
      ctx.apiMessages.push(...result.newApiMessages);
      truncateOldToolResults(ctx.apiMessages, 6);

      // ═══ STRATEGY CALLBACK HOOK ═══
      if (callbacks?.afterRound) {
        const action = await callbacks.afterRound({
          round,
          result,
          apiMessages: ctx.apiMessages,
          assistantPartsThisRound: result.assistantParts,
          config: ctx.config,
          sse: ctx.sse,
          signal: ctx.signal,
          conversation: ctx.conversation,
          contextWindow: ctx.contextWindow,
          turnSpan: ctx.turnSpan,
        });

        if (action.type === "break") break;
        if (action.type === "inject_and_continue") {
          ctx.apiMessages.push(...action.messages);
          // Track extra token usage from sub-agent work
          if (action.extraUsage && ctx.conversation.usage) {
            ctx.conversation.usage.totalInputTokens += action.extraUsage.input;
            ctx.conversation.usage.totalOutputTokens += action.extraUsage.output;
          }
        }
        // type === "continue" falls through naturally
      }

      continue;
    }

    // Pending frontend tool calls
    if (result.stopReason === "tool_use" && result.pendingToolCalls) {
      turnResult = {
        pendingToolCalls: result.pendingToolCalls,
        resolvedToolResults: result.resolvedToolResults,
      };
    }

    break;
  }

  return { allAssistantParts, turnResult };
}
