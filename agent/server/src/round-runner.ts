import Anthropic from "@anthropic-ai/sdk";
import type { ToolRegistry } from "./tools/registry.js";
import type { MessagePart, SseWriter } from "./types.js";
import type { ToolContext } from "./tools/types.js";
import {
  EventType,
  type PendingToolCall,
  type ResolvedToolResult,
} from "./ag-ui-types.js";
import type { SpanHandle } from "./timing.js";
import { fenceToolResult } from "./agent.js";

/**
 * Find the closest matching tool name using Levenshtein distance.
 * Returns the best match if the distance is within a reasonable threshold,
 * or if the candidate is a substring/suffix match. Returns null if nothing
 * is close enough to be a useful suggestion.
 */
/** @internal exported for testing */
export function findClosestTool(
  unknown: string,
  candidates: string[],
): string | null {
  if (candidates.length === 0) return null;

  const lower = unknown.toLowerCase();

  // Exact substring match (model dropped a prefix): "read_file" → "filesystem__read_file"
  const substringHits = candidates.filter((c) =>
    c.toLowerCase().endsWith(lower) || c.toLowerCase().endsWith(`__${lower}`),
  );
  if (substringHits.length === 1) return substringHits[0];

  // Levenshtein distance
  let bestDist = Infinity;
  let bestMatch: string | null = null;
  for (const candidate of candidates) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      bestMatch = candidate;
    }
  }

  // Accept if edit distance is at most 40% of the longer string
  const maxLen = Math.max(lower.length, bestMatch?.length ?? 0);
  if (bestMatch && bestDist <= Math.ceil(maxLen * 0.4)) {
    return bestMatch;
  }

  return null;
}

/** @internal exported for testing */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }

  return dp[n];
}

export interface RoundParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  systemMessage: string;
  apiMessages: Anthropic.MessageParam[];
  toolRegistry: ToolRegistry;
  toolCtx: ToolContext;
  messageId: string;
  signal: AbortSignal;
  sse: SseWriter;
  roundNumber: number;
  parentSpan: SpanHandle;
  /** Anthropic extended thinking config — pass through to the API */
  thinking?: { type: "enabled"; budget_tokens: number } | { type: "disabled" };
  /** Whether to extract <thinking> tags from text output (prompted CoT) */
  extractPromptedThinking?: boolean;
}

export interface RoundResult {
  stopReason: "end_turn" | "tool_use" | "abort" | "error";
  assistantParts: MessagePart[];
  tokenUsage?: { inputTokens: number; outputTokens: number };
  /** Messages to append to apiMessages for the next round (tool_use only). */
  newApiMessages?: Anthropic.MessageParam[];
  /** Frontend tools that need client-side execution. */
  pendingToolCalls?: PendingToolCall[];
  /** Server-side tool results already computed this round. */
  resolvedToolResults?: ResolvedToolResult[];
  error?: string;
}

/**
 * Execute a single LLM round: stream the response, process tool calls,
 * and return structured results for the orchestrator.
 */
export async function runRound(params: RoundParams): Promise<RoundResult> {
  const {
    client, model, maxTokens, temperature, topP,
    systemMessage, apiMessages, toolRegistry, toolCtx,
    messageId, signal, sse, roundNumber, parentSpan,
    thinking, extractPromptedThinking: shouldExtractThinking,
  } = params;

  if (signal.aborted) {
    return { stopReason: "abort", assistantParts: [] };
  }

  sse.writeEvent(EventType.STEP_STARTED, { stepName: `round:${roundNumber}` });

  // Hoisted so the catch block can access partial content on abort
  const assistantParts: MessagePart[] = [];
  let textStarted = false;
  let thinkingStarted = false;
  const toolUseBlocks: { id: string; name: string; partialJson: string }[] = [];

  const llmSpan = parentSpan.span("llm_call", { model, round: roundNumber });

  try {
    console.log(`[agent] round=${roundNumber} calling LLM...`);

    // Pass signal so the SDK actually tears down the HTTP connection on abort,
    // stopping token generation at the provider instead of just ignoring the response.
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemMessage,
      messages: apiMessages,
      tools: toolRegistry.anthropicTools.length > 0
        ? toolRegistry.anthropicTools
        : undefined,
      // When native thinking is enabled, temperature MUST be 1 (Anthropic constraint)
      ...(thinking?.type === "enabled"
        ? {}
        : temperature !== undefined
          ? { temperature }
          : topP !== undefined
            ? { top_p: topP }
            : {}),
      ...(thinking ? { thinking } : {}),
    }, { signal });

    let stopReason: string | null = null;
    let firstTokenMarked = false;

    // ── Stream processing ──
    for await (const event of stream) {
      if (signal.aborted) break;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") {
          assistantParts.push({ type: "text", text: "" });
          if (!textStarted) {
            sse.writeEvent(EventType.TEXT_MESSAGE_START, {
              messageId,
              role: "assistant",
            });
            textStarted = true;
          }
        } else if (block.type === "tool_use") {
          const realName = toolRegistry.origName(block.name);
          toolUseBlocks.push({ id: block.id, name: realName, partialJson: "" });
          sse.writeEvent(EventType.TOOL_CALL_START, {
            toolCallId: block.id,
            toolCallName: realName,
            parentMessageId: messageId,
          });
        } else if (block.type === "thinking") {
          assistantParts.push({ type: "thinking", thinking: "" });
          if (!thinkingStarted) {
            sse.writeEvent(EventType.CUSTOM, {
              name: "thinking_start",
              value: { messageId },
            });
            thinkingStarted = true;
          }
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          if (!firstTokenMarked) {
            llmSpan.mark("first_token");
            firstTokenMarked = true;
          }
          for (let i = assistantParts.length - 1; i >= 0; i--) {
            if (assistantParts[i].type === "text") {
              (assistantParts[i] as { type: "text"; text: string }).text +=
                delta.text;
              break;
            }
          }
          sse.writeEvent(EventType.TEXT_MESSAGE_CONTENT, {
            messageId,
            delta: delta.text,
          });
        } else if (delta.type === "input_json_delta") {
          const current = toolUseBlocks[toolUseBlocks.length - 1];
          if (current) {
            current.partialJson += delta.partial_json;
            sse.writeEvent(EventType.TOOL_CALL_ARGS, {
              toolCallId: current.id,
              delta: delta.partial_json,
            });
          }
        } else if (delta.type === "thinking_delta") {
          // Append to the last thinking part
          for (let i = assistantParts.length - 1; i >= 0; i--) {
            if (assistantParts[i].type === "thinking") {
              (assistantParts[i] as { type: "thinking"; thinking: string }).thinking +=
                (delta as { type: "thinking_delta"; thinking: string }).thinking;
              break;
            }
          }
          sse.writeEvent(EventType.CUSTOM, {
            name: "thinking_delta",
            value: {
              messageId,
              delta: (delta as { type: "thinking_delta"; thinking: string }).thinking,
            },
          });
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? null;
      }
    }

    if (textStarted) {
      sse.writeEvent(EventType.TEXT_MESSAGE_END, { messageId });
    }
    if (thinkingStarted) {
      sse.writeEvent(EventType.CUSTOM, {
        name: "thinking_end",
        value: { messageId },
      });
    }
    for (const block of toolUseBlocks) {
      sse.writeEvent(EventType.TOOL_CALL_END, { toolCallId: block.id });
    }

    // Abort (loop exited via break) — return partial content
    if (signal.aborted) {
      llmSpan.end();
      sse.writeEvent(EventType.STEP_FINISHED, { stepName: `round:${roundNumber}` });
      return { stopReason: "abort", assistantParts };
    }

    // Capture token usage
    let tokenUsage: RoundResult["tokenUsage"];
    try {
      const finalMsg = await stream.finalMessage();
      if (finalMsg.usage) {
        tokenUsage = {
          inputTokens: finalMsg.usage.input_tokens,
          outputTokens: finalMsg.usage.output_tokens,
        };
      }
    } catch {
      // Some providers don't support finalMessage()
    }

    llmSpan.end();

    // ── End of turn (no tool calls) ──
    if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
      sse.writeEvent(EventType.STEP_FINISHED, {
        stepName: `round:${roundNumber}`,
      });
      const finalParts = shouldExtractThinking
        ? extractPromptedThinking(assistantParts)
        : assistantParts;
      return { stopReason: "end_turn", assistantParts: finalParts, tokenUsage };
    }

    // ── Tool execution ──
    // Build API content blocks for the assistant turn (excluding thinking —
    // Claude doesn't accept thinking blocks echoed back).
    const assistantContentBlocks: Anthropic.ContentBlockParam[] = [];
    for (const part of assistantParts) {
      if (part.type === "text" && part.text) {
        assistantContentBlocks.push({ type: "text", text: part.text });
      }
    }

    const parsed = toolUseBlocks.map((block) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(block.partialJson || "{}");
      } catch {
        console.error(`[agent] failed to parse tool args for ${block.name}: ${block.partialJson.slice(0, 200)}`);
        args = {};
      }
      assistantContentBlocks.push({
        type: "tool_use",
        id: block.id,
        name: toolRegistry.wireName(block.name),
        input: args,
      });
      return { ...block, args };
    });

    // Three-way split: server tools (have executor), frontend tools (defined
    // by client but no executor), and unknown tools (model hallucinated or
    // mangled the name). Unknown tools must NOT be sent to the frontend as
    // "pending" — that triggers a re-POST loop. Handle them as server-side
    // errors so the round loop can self-correct.
    const knownFrontendNames = new Set(
      toolRegistry.definitions
        .filter((d) => !toolRegistry.executor.has(d.name))
        .map((d) => d.name),
    );

    const serverTools = parsed.filter((b) => toolRegistry.executor.has(b.name));
    const frontendTools = parsed.filter(
      (b) => !toolRegistry.executor.has(b.name) && knownFrontendNames.has(b.name),
    );
    const unknownTools = parsed.filter(
      (b) => !toolRegistry.executor.has(b.name) && !knownFrontendNames.has(b.name),
    );

    const toolExecSpan = parentSpan.span("tool_execution", {
      count: serverTools.length,
    });

    const serverResults = await Promise.all(
      serverTools.map((block) => {
        const toolSpan = toolExecSpan.span(`tool:${block.name}`, {
          toolName: block.name,
          toolUseId: block.id,
        });
        return toolRegistry.executor
          .execute(block.name, block.id, block.args, toolCtx)
          .finally(() => toolSpan.end());
      }),
    );

    toolExecSpan.end();

    // Build error results for unknown/hallucinated tool names, with fuzzy
    // "did you mean?" suggestions so the model can self-correct.
    const allToolNames = toolRegistry.definitions.map((d) =>
      toolRegistry.wireName(d.name),
    );
    const unknownResults = unknownTools.map((block) => {
      const suggestion = findClosestTool(block.name, allToolNames);
      const hint = suggestion
        ? `Did you mean "${suggestion}"?`
        : `Available tools: ${allToolNames.join(", ")}`;
      console.warn(
        `[agent] unknown tool call: "${block.name}"` +
          (suggestion ? ` → suggested "${suggestion}"` : ""),
      );
      return {
        tool_use_id: block.id,
        content: `Tool "${block.name}" does not exist. ${hint}`,
        is_error: true as const,
      };
    });

    // Emit results + build resolvedToolResults
    const resolvedToolResults: ResolvedToolResult[] = [];
    const allResults = [...serverResults, ...unknownResults];
    const allBlocks = [...serverTools, ...unknownTools];

    for (let i = 0; i < allResults.length; i++) {
      const result = allResults[i];
      const block = allBlocks[i];

      if (!block.name.startsWith("_nexus_")) {
        assistantParts.push({
          type: "tool-call",
          id: block.id,
          name: block.name,
          args: block.args,
          result: result.content,
          isError: result.is_error,
        });
      }

      sse.writeEvent(EventType.TOOL_CALL_RESULT, {
        toolCallId: result.tool_use_id,
        content: result.content,
        isError: result.is_error,
      });

      resolvedToolResults.push({
        toolCallId: result.tool_use_id,
        content: result.content,
        isError: result.is_error ?? false,
      });
    }

    sse.writeEvent(EventType.STEP_FINISHED, {
      stepName: `round:${roundNumber}`,
    });

    // Frontend tools pending — orchestrator handles the break
    if (frontendTools.length > 0) {
      return {
        stopReason: "tool_use",
        assistantParts,
        tokenUsage,
        pendingToolCalls: frontendTools.map((b) => ({
          toolCallId: b.id,
          toolCallName: b.name,
          args: b.args,
        })),
        resolvedToolResults,
      };
    }

    // All server-side (including unknown tool errors) — build apiMessages for next round
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = allResults.map(
      (r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: fenceToolResult(r.content),
        is_error: r.is_error,
      }),
    );

    return {
      stopReason: "tool_use",
      assistantParts,
      tokenUsage,
      resolvedToolResults,
      newApiMessages: [
        { role: "assistant" as const, content: assistantContentBlocks },
        { role: "user" as const, content: toolResultBlocks },
      ],
    };
  } catch (err) {
    // Abort throws from the Anthropic SDK — return partial content, not an error
    if (signal.aborted) {
      llmSpan.setMetadata("aborted", true);
      llmSpan.mark("abort");
      llmSpan.end();
      if (textStarted) {
        sse.writeEvent(EventType.TEXT_MESSAGE_END, { messageId });
      }
      for (const block of toolUseBlocks) {
        sse.writeEvent(EventType.TOOL_CALL_END, { toolCallId: block.id });
      }
      sse.writeEvent(EventType.STEP_FINISHED, {
        stepName: `round:${roundNumber}`,
      });
      return { stopReason: "abort", assistantParts };
    }

    llmSpan.setMetadata("error", true);
    llmSpan.end();
    const message = err instanceof Error ? err.message : String(err);
    sse.writeEvent(EventType.RUN_ERROR, { message });
    sse.writeEvent(EventType.STEP_FINISHED, {
      stepName: `round:${roundNumber}`,
    });
    return { stopReason: "error", assistantParts: [], error: message };
  }
}

/**
 * Extract `<thinking>...</thinking>` tags from text parts into separate
 * thinking MessageParts. Used for prompted CoT (non-native models).
 */
/** @internal exported for testing */
export function extractPromptedThinking(parts: MessagePart[]): MessagePart[] {
  const result: MessagePart[] = [];
  for (const part of parts) {
    if (part.type !== "text") {
      result.push(part);
      continue;
    }
    const match = part.text.match(/^<thinking>([\s\S]*?)<\/thinking>\s*/);
    if (match) {
      result.push({ type: "thinking", thinking: match[1].trim() });
      const remainder = part.text.slice(match[0].length).trim();
      if (remainder) result.push({ type: "text", text: remainder });
    } else {
      result.push(part);
    }
  }
  return result;
}
