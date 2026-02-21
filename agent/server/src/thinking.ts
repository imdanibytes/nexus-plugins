import type { TurnConfig } from "./turn-config.js";
import type { ProviderType } from "./types.js";

type ThinkingParam =
  | { type: "enabled"; budget_tokens: number }
  | { type: "disabled" };

/**
 * Resolve the Anthropic API `thinking` parameter from agent config.
 *
 * Returns `undefined` if no thinking config is set or if the model
 * doesn't support native extended thinking (prompted CoT is handled
 * separately via a system message provider).
 */
export function resolveThinkingConfig(
  config: TurnConfig,
): ThinkingParam | undefined {
  const agentThinking = config.agent?.thinking;
  if (!agentThinking || agentThinking.mode === "disabled") return undefined;

  if (agentThinking.mode === "native" || agentThinking.mode === "auto") {
    if (supportsNativeThinking(config.model, config.provider?.type)) {
      const budget = agentThinking.budgetTokens ?? 10000;
      return { type: "enabled", budget_tokens: Math.max(1024, budget) };
    }
  }

  // "prompted" mode or "auto" for non-native models — handled by
  // thinking-prompt system message provider, not the API parameter.
  return undefined;
}

/**
 * Check whether a model supports Anthropic's native extended thinking.
 */
export function supportsNativeThinking(
  model: string,
  providerType?: ProviderType,
): boolean {
  if (providerType !== "anthropic" && providerType !== "bedrock") return false;

  // Claude 3.7 Sonnet, Claude 4 family, and future models
  return /claude-(3-7-sonnet|sonnet-4|opus-4|haiku-4)/i.test(model);
}
