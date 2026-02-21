import type Anthropic from "@anthropic-ai/sdk";
import { getModelTier } from "../config/model-tiers.js";
import { getAgent } from "../config/agents.js";
import { getProvider } from "../config/providers.js";
import { createLlmClient } from "../config/client-factory.js";
import type { WireMessage } from "../types.js";

const PHRASE_PROMPT = [
  "Generate a very short activity phrase (2-4 words) describing what you'd be doing to respond to this message.",
  "Examples: Analyzing code, Researching topic, Drafting response, Reading documentation, Thinking about architecture, Checking details, Considering approach",
  "Output ONLY the phrase. No quotes, no punctuation, no explanation. Use present participle (-ing form).",
].join("\n");

/**
 * Curated fallback phrases when no fast model is available.
 * Rotated randomly so consecutive turns don't feel stale.
 */
const FALLBACK_PHRASES = [
  "Processing request",
  "Analyzing message",
  "Considering approach",
  "Working on it",
  "Preparing response",
  "Gathering thoughts",
  "Reviewing context",
];

interface PhraseConfig {
  client: Anthropic;
  model: string;
}

async function resolveClient(
  fallback: PhraseConfig,
): Promise<{ client: Anthropic; model: string } | null> {
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
  // Don't fall back to the main model — that would be wasteful.
  // Return null to use the curated fallback list instead.
  return null;
}

/**
 * Generate a short contextual activity phrase for the UI status indicator.
 *
 * Uses a fast-tier model if available; falls back to a curated phrase list.
 * Always returns a phrase — never null.
 */
export async function generateActivityPhrase(
  recentMessages: WireMessage[],
  fallback: PhraseConfig,
  signal: AbortSignal,
): Promise<string> {
  const fallbackPhrase =
    FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)];

  if (recentMessages.length === 0) return fallbackPhrase;

  const resolved = await resolveClient(fallback);
  if (!resolved) return fallbackPhrase;

  const { client, model } = resolved;

  // Just the last user message — keep it tiny
  const lastUser = [...recentMessages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUser) return fallbackPhrase;

  const content =
    lastUser.content.length > 200
      ? lastUser.content.slice(0, 200) + "…"
      : lastUser.content;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 20,
      system: PHRASE_PROMPT,
      messages: [{ role: "user", content }],
    });

    if (signal.aborted) return fallbackPhrase;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text || text.length > 40) return fallbackPhrase;

    // Clean: strip quotes, trailing dots, ensure it ends cleanly
    const cleaned = text
      .replace(/^["']|["']$/g, "")
      .replace(/\.+$/, "")
      .trim();

    return cleaned || fallbackPhrase;
  } catch {
    return fallbackPhrase;
  }
}
