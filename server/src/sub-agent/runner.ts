import Anthropic from "@anthropic-ai/sdk";
import { ToolExecutor } from "../tools/executor.js";

// ── Types ──

export interface SubAgentConfig {
  client: Anthropic;
  model: string;
  maxTokens: number;
  temperature?: number;
  systemPrompt: string;
  /** Scoped context — typically just the goal, not the full conversation */
  messages: Anthropic.MessageParam[];
  /** Tools available to the sub-agent (Anthropic wire format) */
  tools?: Anthropic.Tool[];
  /** Executor for server-side tool calls within the sub-agent */
  toolExecutor?: ToolExecutor;
  /** Prevent runaway loops */
  maxRounds: number;
  signal: AbortSignal;
  /** Optional callback for live progress updates */
  onProgress?: (event: SubAgentProgress) => void;
}

export interface SubAgentResult {
  /** Concatenated text output from all rounds */
  text: string;
  /** Summary of tool calls made during execution */
  toolCalls: ToolCallSummary[];
  /** Total token usage across all rounds */
  tokenUsage: { input: number; output: number };
  /** Number of LLM rounds executed */
  rounds: number;
}

export interface ToolCallSummary {
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export type SubAgentProgress =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string; isError: boolean }
  | { type: "round_complete"; round: number };

// ── Runner ──

/**
 * Run a scoped sub-agent: independent LLM loop with its own system prompt,
 * tools, and context. No SSE streaming, no conversation persistence.
 *
 * Returns the accumulated text output and a summary of tool calls.
 */
export async function runSubAgent(config: SubAgentConfig): Promise<SubAgentResult> {
  const {
    client, model, maxTokens, temperature,
    systemPrompt, tools, toolExecutor,
    maxRounds, signal, onProgress,
  } = config;

  const messages: Anthropic.MessageParam[] = [...config.messages];
  const allToolCalls: ToolCallSummary[] = [];
  const totalUsage = { input: 0, output: 0 };
  const textParts: string[] = [];
  let round = 0;

  while (round < maxRounds) {
    if (signal.aborted) break;
    round++;

    // Call LLM (non-streaming — sub-agents don't need SSE)
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      ...(temperature !== undefined ? { temperature } : {}),
    });

    // Accumulate token usage
    if (response.usage) {
      totalUsage.input += response.usage.input_tokens;
      totalUsage.output += response.usage.output_tokens;
    }

    // Extract text and tool_use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textBlocks.push(block.text);
        onProgress?.({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        onProgress?.({ type: "tool_call", name: block.name, args: block.input as Record<string, unknown> });
      }
    }

    if (textBlocks.length > 0) {
      textParts.push(textBlocks.join("\n"));
    }

    // No tool calls or end of turn — we're done
    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      onProgress?.({ type: "round_complete", round });
      break;
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      let resultContent: string;
      let isError = false;

      if (toolExecutor?.has(block.name)) {
        // Create a minimal tool context for sub-agent tool execution
        // Sub-agent tools don't get SSE or conversation access
        const result = await toolExecutor.execute(
          block.name,
          block.id,
          block.input,
          {
            conversationId: "",
            sse: { writeEvent: () => {}, close: () => {} },
            conversation: { id: "", title: "", createdAt: 0, updatedAt: 0, messages: [] },
            saveConversation: () => {},
            signal,
          },
        );
        resultContent = result.content;
        isError = result.is_error ?? false;
      } else {
        resultContent = `Tool "${block.name}" not available in this sub-agent scope`;
        isError = true;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
        is_error: isError,
      });

      const summary: ToolCallSummary = {
        name: block.name,
        args: block.input,
        result: resultContent,
        isError,
      };
      allToolCalls.push(summary);
      onProgress?.({ type: "tool_result", name: block.name, result: resultContent, isError });
    }

    // Append assistant message + tool results for next round
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    onProgress?.({ type: "round_complete", round });
  }

  return {
    text: textParts.join("\n\n"),
    toolCalls: allToolCalls,
    tokenUsage: totalUsage,
    rounds: round,
  };
}
