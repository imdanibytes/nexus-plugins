import type { SystemMessageProvider, SystemMessageContext } from "../types.js";
import { supportsNativeThinking } from "../../thinking.js";

/**
 * For models in "prompted" or "auto" mode that lack native extended thinking,
 * inject instructions to use <thinking>...</thinking> tags for chain of thought.
 */
export const thinkingPromptProvider: SystemMessageProvider = {
  name: "thinking-prompt",
  timeoutMs: 100,

  async provide(ctx: SystemMessageContext): Promise<string | null> {
    const agent = ctx.agent;
    if (!agent?.thinking) return null;
    if (agent.thinking.mode === "disabled" || agent.thinking.mode === "native") {
      return null;
    }

    // "auto" mode: skip if the model has native thinking
    if (agent.thinking.mode === "auto") {
      // We need provider type — infer from settings fallback
      if (supportsNativeThinking(agent.model)) return null;
    }

    return [
      "<thinking_instructions>",
      "Before responding, reason through the problem step by step inside <thinking>...</thinking> tags.",
      "Your thinking process will be shown to the user as a collapsible section.",
      "After your thinking, provide your actual response outside the tags.",
      "Do NOT include <thinking> tags when making tool calls — only when producing a final text response.",
      "</thinking_instructions>",
    ].join("\n");
  },
};
