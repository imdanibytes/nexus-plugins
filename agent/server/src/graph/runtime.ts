import type { AgentMode, TransitionSignal, NodeRunResult, GraphContext } from "./types.js";
import type { TurnStrategyContext, TurnStrategyResult, RoundLoopCallbacks } from "../strategy/types.js";
import type { MessagePart } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LoopGuardState } from "../mechanics/loop-guard.js";
import { StateGraphEngine } from "./engine.js";
import { runRound } from "../round-runner.js";
import { resolveThinkingConfig, supportsNativeThinking } from "../thinking.js";
import { resolvePrice, calculateCost } from "../compaction/pricing.js";
import { truncateOldToolResults } from "../compaction/pipeline.js";
import { checkLoopGuard, createLoopGuardState, updateLoopGuard } from "../mechanics/loop-guard.js";
import { getTaskState, saveTaskState } from "../tasks/storage.js";
import { EventType } from "../ag-ui-types.js";

/**
 * The graph runtime — the agent IS the graph.
 *
 * Each agent mode (general, discovery, planning, execution, review) is a node.
 * A node's job is to run the LLM round loop for that phase — with scoped tools,
 * scoped system message, and scoped constraints. When the LLM triggers a
 * transition (via workflow_set_mode), the current node yields and the graph
 * routes to the next node.
 *
 * This replaces the old architecture where a passive graph was consulted by a
 * separate execution loop. Here the graph drives execution.
 */
export class AgentGraph {
  constructor(private engine: StateGraphEngine) {}

  /**
   * Run the graph — the top-level execution loop.
   *
   * Enters the current mode's node, runs its scoped round loop, and routes
   * to the next node on transition. Exits when a node finishes without
   * requesting a transition (end_turn, abort, pending_frontend, max_rounds).
   */
  async run(
    ctx: TurnStrategyContext,
    callbacks?: RoundLoopCallbacks,
  ): Promise<TurnStrategyResult> {
    let mode = getTaskState(ctx.conversationId).mode;
    const allAssistantParts: MessagePart[] = [];
    let turnResult: TurnStrategyResult["turnResult"] = {};

    // Resolve thinking config once for the entire turn
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

    // Loop guard and round budget are shared across nodes
    const loopGuard = createLoopGuardState();
    let totalRounds = 0;

    while (true) {
      if (ctx.signal.aborted) break;

      // Build tool registry scoped to this node's mode
      const registry = await ctx.rebuildToolRegistry();

      // Create a scoped transition signal for this node — tools set it
      // to request transitions without knowing about the graph
      const transitionSignal: TransitionSignal = {
        requested: false,
        target: null,
        reason: "",
      };
      ctx.toolCtx.transitionSignal = transitionSignal;

      console.log(`[graph] entering node: ${mode}`);

      // Run the node's scoped round loop
      const result = await this.runNode(mode, ctx, {
        registry,
        transitionSignal,
        callbacks,
        loopGuard,
        roundOffset: totalRounds,
        thinkingConfig,
        usePromptedCoT,
      });

      totalRounds += result.roundsUsed ?? 0;
      allAssistantParts.push(...result.assistantParts);

      if (result.reason === "transition" && result.transition) {
        // Execute the transition — hooks, guards, state mutation
        const taskState = getTaskState(ctx.conversationId);
        const graphCtx: GraphContext = {
          conversationId: ctx.conversationId,
          state: taskState,
          sse: ctx.sse,
        };

        console.log(`[graph] transition: ${mode} \u2192 ${result.transition.to} (${result.transition.reason})`);

        const edge = await this.engine.executeTransition(
          mode,
          result.transition.to,
          graphCtx,
        );

        if (!edge.valid) {
          // Shouldn't happen — tool already validated. Safety net.
          console.warn(`[graph] transition rejected at execute: ${edge.reason}`);
          break;
        }

        mode = result.transition.to;
        saveTaskState(ctx.conversationId, graphCtx.state);
        continue;
      }

      // Any other exit reason — done
      turnResult = result.turnResult;
      break;
    }

    // Clean up transition signal
    ctx.toolCtx.transitionSignal = undefined;

    return { allAssistantParts, turnResult };
  }

  /**
   * Run a single node — a scoped round loop for one mode.
   *
   * Uses a fixed tool registry (built for this mode) and watches the
   * transition signal after each round. When the signal fires, the node
   * yields back to the graph for routing.
   */
  private async runNode(
    _mode: AgentMode,
    ctx: TurnStrategyContext,
    opts: {
      registry: ToolRegistry;
      transitionSignal: TransitionSignal;
      callbacks?: RoundLoopCallbacks;
      loopGuard: LoopGuardState;
      roundOffset: number;
      thinkingConfig?: { type: "enabled"; budget_tokens: number } | { type: "disabled" };
      usePromptedCoT: boolean;
    },
  ): Promise<NodeRunResult> {
    const {
      registry, transitionSignal, callbacks, loopGuard,
      thinkingConfig, usePromptedCoT,
    } = opts;
    let round = opts.roundOffset;
    const assistantParts: MessagePart[] = [];
    let turnResult: NodeRunResult["turnResult"] = {};
    let roundsUsed = 0;

    while (round < ctx.maxRounds) {
      if (ctx.signal.aborted) break;
      round++;
      roundsUsed++;

      const roundSpan = ctx.turnSpan.span(`round:${round}`, { round });

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

      assistantParts.push(...result.assistantParts);

      // ── Token tracking ──
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
        return { reason: "max_rounds", assistantParts, turnResult, roundsUsed };
      }

      // ── Check transition signal (tool called workflow_set_mode this round) ──
      if (transitionSignal.requested && transitionSignal.target) {
        return {
          reason: "transition",
          transition: {
            to: transitionSignal.target,
            reason: transitionSignal.reason,
          },
          assistantParts,
          turnResult,
          roundsUsed,
        };
      }

      // ── Check interrupt ──
      const taskState = getTaskState(ctx.conversationId);
      if (taskState.interrupt) {
        return { reason: "interrupt", assistantParts, turnResult, roundsUsed };
      }

      // ── Continue tool loop or break ──
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
            if (action.extraUsage && ctx.conversation.usage) {
              ctx.conversation.usage.totalInputTokens += action.extraUsage.input;
              ctx.conversation.usage.totalOutputTokens += action.extraUsage.output;
            }
          }
        }

        continue;
      }

      // Pending frontend tool calls
      if (result.stopReason === "tool_use" && result.pendingToolCalls) {
        turnResult = {
          pendingToolCalls: result.pendingToolCalls,
          resolvedToolResults: result.resolvedToolResults,
        };
        return { reason: "pending_frontend", assistantParts, turnResult, roundsUsed };
      }

      // end_turn or error — exit node
      break;
    }

    // Determine exit reason
    if (ctx.signal.aborted) {
      return { reason: "abort", assistantParts, turnResult, roundsUsed };
    }

    if (round >= ctx.maxRounds) {
      return { reason: "max_rounds", assistantParts, turnResult, roundsUsed };
    }

    return { reason: "end_turn", assistantParts, turnResult, roundsUsed };
  }
}
