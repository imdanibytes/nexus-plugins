import type Anthropic from "@anthropic-ai/sdk";
import { getModelTier } from "../config/model-tiers.js";
import { getAgent } from "../config/agents.js";
import { getProvider } from "../config/providers.js";
import { createLlmClient } from "../config/client-factory.js";
import type { WireMessage } from "../types.js";

const FOLLOW_UP_PROMPT = `You generate suggestion chips for a chat UI. These chips are buttons the USER clicks to send their next message.

CRITICAL: Every suggestion must be written AS the user talking TO the assistant. The user clicks it and it gets sent as their message.

GOOD suggestions (user talking to assistant):
["Tell me more about the caching layer", "Can you refactor that function?", "What are the trade-offs?"]

BAD suggestions (assistant talking to user — NEVER DO THIS):
["Hi, how can I help?", "What can I do for you?", "Let me explain...", "I can help with..."]

Rules:
- Return ONLY a JSON array of 2-3 strings
- Each under 60 characters
- Written as if the user is speaking
- If the conversation is too vague for meaningful suggestions, return []`;

interface FollowUpConfig {
  client: Anthropic;
  model: string;
}

/**
 * Resolve the LLM client for follow-up generation.
 * Prefers the fast tier agent; falls back to the provided config.
 */
async function resolveClient(fallback: FollowUpConfig): Promise<{ client: Anthropic; model: string }> {
  const agentId = getModelTier("fast");
  if (agentId) {
    const agent = getAgent(agentId);
    if (agent) {
      const provider = await getProvider(agent.providerId);
      if (provider) {
        const client = await createLlmClient(provider);
        return { client, model: agent.model };
      }
    }
  }
  return fallback;
}

/**
 * Generate follow-up suggestions based on recent conversation messages.
 * Returns an array of suggestion strings, or null on failure/abort.
 *
 * Runs a single non-streaming LLM call — fast tier preferred, tiny prompt.
 */
export async function generateFollowUps(
  recentMessages: WireMessage[],
  fallback: FollowUpConfig,
  signal: AbortSignal,
): Promise<string[] | null> {
  if (recentMessages.length === 0) return null;

  // Skip if the last message is from the user (suggestions only after assistant responses)
  const last = recentMessages[recentMessages.length - 1];
  if (last.role === "user") return null;

  // Skip trivial exchanges — not enough substance to suggest from
  const totalContent = recentMessages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalContent < 100) return null;

  const { client, model } = await resolveClient(fallback);

  // Build a compact representation of recent messages (last 3 max)
  const tail = recentMessages.slice(-3);
  const messageSummary = tail
    .map((m) => {
      const content = m.content.length > 400 ? m.content.slice(0, 400) + "…" : m.content;
      return `${m.role}: ${content}`;
    })
    .join("\n\n");

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 150,
      system: FOLLOW_UP_PROMPT,
      messages: [{ role: "user", content: `Messages:\n${messageSummary}` }],
    });

    if (signal.aborted) return null;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) return null;

    // Extract JSON array from response (may have surrounding text)
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;

    // Validate and clean each suggestion
    const suggestions = parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 80))
      .slice(0, 3);

    return suggestions.length > 0 ? suggestions : null;
  } catch (err) {
    // Follow-up generation is best-effort — never fail the turn
    console.error("[follow-ups] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
