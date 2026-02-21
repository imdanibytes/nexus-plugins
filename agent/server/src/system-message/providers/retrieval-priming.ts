import type { SystemMessageProvider, SystemMessageContext } from "../types.js";
import { getMcpClient } from "../../protocol/mcp-client.js";

// ── Indexer availability cache ──

let indexerAvailable: boolean | null = null;
let lastIndexerCheck = 0;
const INDEXER_CHECK_TTL = 60_000;

async function isIndexerAvailable(): Promise<boolean> {
  if (indexerAvailable !== null && Date.now() - lastIndexerCheck < INDEXER_CHECK_TTL) {
    return indexerAvailable;
  }
  try {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    indexerAvailable = tools.some((t) => t.name === "codebase-indexer.search");
    lastIndexerCheck = Date.now();
    return indexerAvailable;
  } catch {
    indexerAvailable = false;
    lastIndexerCheck = Date.now();
    return false;
  }
}

// ── Types ──

interface SearchResult {
  file_path: string;
  language?: string;
  start_line?: number;
  end_line?: number;
  score: number;
  content?: string;
  snippet?: string;
  symbol_name?: string;
}

// ── Provider ──

export const retrievalPrimingProvider: SystemMessageProvider = {
  name: "retrieval-priming",
  timeoutMs: 5000,

  async provide(ctx: SystemMessageContext): Promise<string | null> {
    // Gate 1: agent must opt in
    if (!ctx.agent?.retrievalPriming?.enabled) return null;

    // Gate 2: indexer must be available
    if (!(await isIndexerAvailable())) return null;

    // Gate 3: need wire messages to extract query
    const wireMessages = ctx.wireMessages;
    if (!wireMessages || wireMessages.length === 0) return null;

    // Extract query from last user message
    const lastUserMsg = [...wireMessages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg?.content) return null;

    const query = lastUserMsg.content.slice(0, 500);
    const maxChars = ctx.agent.retrievalPriming.maxChars ?? 8000;

    try {
      const client = await getMcpClient();
      const result = await client.callTool({
        name: "codebase-indexer.search",
        arguments: { query, limit: 10, full_content: true },
      });

      const text = (result.content as { type: string; text: string }[])
        .map((c) => c.text)
        .join("\n");

      let parsed: SearchResult[];
      try {
        parsed = JSON.parse(text);
      } catch {
        // Search returned non-JSON (e.g. error message)
        return null;
      }

      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      // Fill budget greedily by relevance (results come pre-sorted by score)
      const blocks: string[] = [];
      let totalChars = 0;

      for (const chunk of parsed) {
        const block = formatChunk(chunk);
        if (totalChars + block.length > maxChars) break;
        blocks.push(block);
        totalChars += block.length;
      }

      if (blocks.length === 0) return null;

      return `<retrieved_context>\nThe following code was automatically retrieved based on the user's message. Use it as reference context.\n${blocks.join("\n")}\n</retrieved_context>`;
    } catch (err) {
      console.warn("[retrieval-priming] search failed:", err);
      return null;
    }
  },
};

function formatChunk(chunk: SearchResult): string {
  const content = chunk.content ?? chunk.snippet ?? "";
  if (!content) return "";

  const lineRange =
    chunk.start_line != null && chunk.end_line != null
      ? ` lines="${chunk.start_line}-${chunk.end_line}"`
      : "";
  const lang = chunk.language ? ` language="${chunk.language}"` : "";
  const score = ` score="${chunk.score.toFixed(2)}"`;
  const symbol = chunk.symbol_name ? ` symbol="${chunk.symbol_name}"` : "";

  return `<file path="${chunk.file_path}"${lineRange}${score}${lang}${symbol}>\n${content}\n</file>`;
}
