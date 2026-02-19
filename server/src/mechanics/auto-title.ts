import type Anthropic from "@anthropic-ai/sdk";
import { getModelTier } from "../model-tiers.js";
import { getAgent } from "../agents.js";
import { getProvider } from "../providers.js";
import { createLlmClient } from "../client-factory.js";
import type { WireMessage } from "../types.js";

const TITLE_PROMPT = [
  "Generate a short conversation title (3-8 words) based on the messages below.",
  "If a current title is provided and it still accurately describes the conversation topic, respond with exactly: KEEP",
  "If the topic has shifted or the title is generic (like 'New conversation'), respond with ONLY the new title — no quotes, no explanation.",
].join("\n");

interface TitleConfig {
  /** Fallback client if fast tier isn't configured */
  client: Anthropic;
  /** Fallback model if fast tier isn't configured */
  model: string;
}

/**
 * Resolve the LLM client for title generation.
 * Prefers the fast tier agent; falls back to the provided config.
 */
async function resolveTitleClient(fallback: TitleConfig): Promise<{ client: Anthropic; model: string }> {
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
 * Automatically generate or update a conversation title.
 * Returns the new title, or null if the current title should be kept.
 *
 * Runs a single non-streaming LLM call — fast tier preferred, tiny prompt.
 */
export async function generateTitle(
  currentTitle: string,
  recentMessages: WireMessage[],
  fallback: TitleConfig,
  signal: AbortSignal,
): Promise<string | null> {
  if (recentMessages.length === 0) return null;

  const { client, model } = await resolveTitleClient(fallback);

  // Build a compact representation of recent messages (last 4 max)
  const tail = recentMessages.slice(-4);
  const messageSummary = tail
    .map((m) => {
      const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
      return `${m.role}: ${content}`;
    })
    .join("\n\n");

  const userContent =
    currentTitle && currentTitle !== "New conversation"
      ? `Current title: ${currentTitle}\n\nMessages:\n${messageSummary}`
      : `Messages:\n${messageSummary}`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 30,
      system: TITLE_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    if (signal.aborted) return null;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text || text.toUpperCase() === "KEEP") return null;

    // Clean up: strip quotes, limit length
    const cleaned = text.replace(/^["']|["']$/g, "").trim().slice(0, 100);
    return cleaned || null;
  } catch (err) {
    // Title generation is best-effort — never fail the turn
    console.error("[auto-title] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
