import { describe, it, expect, vi } from "vitest";
import { CompactionPipeline, truncateOldToolResults } from "../../src/compaction/pipeline.js";
import type { CompactionPass, CompactionContext } from "../../src/compaction/types.js";
import type { WireMessage } from "../../src/types.js";
import type Anthropic from "@anthropic-ai/sdk";

// ── Helpers ──

function makePass(
  name: string,
  threshold: number,
  transform?: (msgs: WireMessage[]) => WireMessage[],
): CompactionPass {
  return {
    name,
    threshold,
    compact: (messages, _ctx) => ({
      messages: transform ? transform(messages) : messages,
      report: {
        passesRun: [name],
        entries: [],
        estimatedTokensSaved: 100,
      },
    }),
  };
}

function makeMessages(count: number): WireMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}`,
  }));
}

function makeCtx(overrides: Partial<CompactionContext> = {}): CompactionContext {
  return {
    tokenUsage: 50_000,
    tokenLimit: 100_000,
    recentWindowSize: 4,
    ...overrides,
  };
}

// ── CompactionPipeline ──

describe("CompactionPipeline", () => {
  describe("register", () => {
    it("sorts passes by threshold", () => {
      const pipeline = new CompactionPipeline();
      const passHigh = makePass("high", 0.9);
      const passLow = makePass("low", 0.3);
      const passMid = makePass("mid", 0.6);

      pipeline.register(passHigh);
      pipeline.register(passLow);
      pipeline.register(passMid);

      // Run at 100% — all passes should activate in threshold order
      const result = pipeline.run(makeMessages(1), makeCtx({ tokenUsage: 100_000 }));
      expect(result.report.passesRun).toEqual(["low", "mid", "high"]);
    });
  });

  describe("run", () => {
    it("returns messages unchanged when no passes are active", () => {
      const pipeline = new CompactionPipeline();
      pipeline.register(makePass("high", 0.8));

      const messages = makeMessages(3);
      // 10% usage — well below 80% threshold
      const result = pipeline.run(messages, makeCtx({ tokenUsage: 10_000 }));
      expect(result.messages).toBe(messages); // same reference
      expect(result.report.passesRun).toEqual([]);
      expect(result.report.estimatedTokensSaved).toBe(0);
    });

    it("activates passes whose threshold is met", () => {
      const pipeline = new CompactionPipeline();
      pipeline.register(makePass("low", 0.3));
      pipeline.register(makePass("high", 0.8));

      // 50% usage — only low pass triggers
      const result = pipeline.run(makeMessages(1), makeCtx({ tokenUsage: 50_000 }));
      expect(result.report.passesRun).toEqual(["low"]);
    });

    it("chains pass output as input to the next pass", () => {
      const pipeline = new CompactionPipeline();

      pipeline.register(
        makePass("first", 0.1, (msgs) => [...msgs, { role: "user" as const, content: "added_by_first" }]),
      );
      pipeline.register(
        makePass("second", 0.2, (msgs) => msgs.filter((m) => m.content !== "Message 0")),
      );

      const messages = makeMessages(2); // Message 0, Message 1
      const result = pipeline.run(messages, makeCtx({ tokenUsage: 50_000 }));

      // first adds "added_by_first", second removes "Message 0"
      expect(result.messages).toHaveLength(2); // Message 1 + added_by_first
      expect(result.messages[0].content).toBe("Message 1");
      expect(result.messages[1].content).toBe("added_by_first");
    });

    it("merges reports from all active passes", () => {
      const pipeline = new CompactionPipeline();
      pipeline.register(makePass("a", 0.1));
      pipeline.register(makePass("b", 0.2));

      const result = pipeline.run(makeMessages(1), makeCtx({ tokenUsage: 50_000 }));
      expect(result.report.passesRun).toEqual(["a", "b"]);
      expect(result.report.estimatedTokensSaved).toBe(200); // 100 + 100
    });

    it("handles zero tokenLimit without division error", () => {
      const pipeline = new CompactionPipeline();
      pipeline.register(makePass("any", 0.5));

      // tokenLimit=0 → ratio=0 → no passes trigger
      const result = pipeline.run(makeMessages(1), makeCtx({ tokenLimit: 0 }));
      expect(result.report.passesRun).toEqual([]);
    });
  });
});

// ── truncateOldToolResults ──

describe("truncateOldToolResults", () => {
  function makeToolResultMessages(
    resultContents: string[],
  ): Anthropic.MessageParam[] {
    return resultContents.map((content, i) => ({
      role: "user" as const,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: `t${i}`,
          content,
        },
      ],
    }));
  }

  it("returns zero truncations for empty messages", () => {
    const result = truncateOldToolResults([], 2);
    expect(result).toEqual({ truncated: 0, tokensSaved: 0 });
  });

  it("does not truncate when all results are within keepRecent window", () => {
    const msgs = makeToolResultMessages(["a".repeat(500), "b".repeat(500)]);
    const result = truncateOldToolResults(msgs, 2);
    expect(result.truncated).toBe(0);
  });

  it("truncates results beyond keepRecent window", () => {
    const msgs = makeToolResultMessages([
      "a".repeat(500),
      "b".repeat(500),
      "c".repeat(500),
    ]);
    // Keep 1 recent — the last message. Truncate the first 2.
    const result = truncateOldToolResults(msgs, 1);
    expect(result.truncated).toBe(2);
    expect(result.tokensSaved).toBeGreaterThan(0);

    // First two messages should have placeholder content
    const block0 = (msgs[0].content as Anthropic.ToolResultBlockParam[])[0];
    expect(block0.content).toContain("[Tool result truncated");
  });

  it("skips small results (≤200 chars)", () => {
    const msgs = makeToolResultMessages([
      "small", // 5 chars — too small to truncate
      "b".repeat(500),
    ]);
    const result = truncateOldToolResults(msgs, 0);
    // Only one truncation — the large one
    expect(result.truncated).toBe(1);

    // Small result untouched
    const block0 = (msgs[0].content as Anthropic.ToolResultBlockParam[])[0];
    expect(block0.content).toBe("small");
  });

  it("handles mixed content in user messages (non-tool_result blocks ignored)", () => {
    const msgs: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Some text" },
          { type: "tool_result" as const, tool_use_id: "t1", content: "x".repeat(500) },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result" as const, tool_use_id: "t2", content: "y".repeat(500) },
        ],
      },
    ];

    const result = truncateOldToolResults(msgs, 1);
    // t2 is most recent (walking backwards), so t1 gets truncated
    expect(result.truncated).toBe(1);
  });

  it("skips non-user messages", () => {
    const msgs: Anthropic.MessageParam[] = [
      { role: "assistant", content: "I used a tool" },
      {
        role: "user",
        content: [
          { type: "tool_result" as const, tool_use_id: "t1", content: "x".repeat(500) },
        ],
      },
    ];
    const result = truncateOldToolResults(msgs, 1);
    expect(result.truncated).toBe(0);
  });
});
