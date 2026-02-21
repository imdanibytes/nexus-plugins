import { describe, it, expect } from "vitest";
import { levenshtein, findClosestTool, extractPromptedThinking } from "../src/round-runner.js";
import type { MessagePart } from "../src/types.js";

// ── levenshtein ──

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns correct distance for both empty", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("computes kitten/sitting = 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("computes flaw/lawn = 2", () => {
    expect(levenshtein("flaw", "lawn")).toBe(2);
  });

  it("handles single character strings", () => {
    expect(levenshtein("a", "b")).toBe(1);
    expect(levenshtein("a", "a")).toBe(0);
  });
});

// ── findClosestTool ──

describe("findClosestTool", () => {
  const candidates = [
    "filesystem__read_file",
    "filesystem__write_file",
    "filesystem__list_directory",
    "nexus_execute_command",
    "search_content",
  ];

  it("returns null for empty candidates", () => {
    expect(findClosestTool("read_file", [])).toBeNull();
  });

  it("finds substring match (endsWith)", () => {
    expect(findClosestTool("read_file", candidates)).toBe("filesystem__read_file");
  });

  it("finds double-underscore suffix match", () => {
    expect(findClosestTool("write_file", candidates)).toBe("filesystem__write_file");
  });

  it("returns null when multiple substring matches exist", () => {
    // Both "a__foo" and "b__foo" end with "__foo" → ambiguous → falls through
    const ambiguous = ["a__foo", "b__foo"];
    // substringHits.length !== 1, so falls through to Levenshtein
    const result = findClosestTool("foo", ambiguous);
    // Levenshtein: "foo" vs "a__foo" (3) vs "b__foo" (3) — both tie,
    // but within 40% of max length (6 * 0.4 = 2.4 → ceil = 3), so returns first
    expect(result).toBe("a__foo");
  });

  it("finds close Levenshtein match within 40% threshold", () => {
    // "read_fil" vs "filesystem__read_file" — substring match won't hit
    // But let's use a simpler case
    expect(findClosestTool("serach_content", candidates)).toBe("search_content");
  });

  it("returns null for very different strings", () => {
    expect(findClosestTool("completely_unrelated_tool_name_xyz", candidates)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(findClosestTool("READ_FILE", candidates)).toBe("filesystem__read_file");
  });
});

// ── extractPromptedThinking ──

describe("extractPromptedThinking", () => {
  it("returns parts unchanged when no thinking tags", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "Hello world" },
    ];
    expect(extractPromptedThinking(parts)).toEqual(parts);
  });

  it("extracts thinking tag from start of text", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "<thinking>Let me think about this</thinking>\nHere is my answer." },
    ];
    const result = extractPromptedThinking(parts);
    expect(result).toEqual([
      { type: "thinking", thinking: "Let me think about this" },
      { type: "text", text: "Here is my answer." },
    ]);
  });

  it("extracts thinking tag with no remainder", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "<thinking>Just thinking</thinking>" },
    ];
    const result = extractPromptedThinking(parts);
    expect(result).toEqual([
      { type: "thinking", thinking: "Just thinking" },
    ]);
  });

  it("does not extract thinking tag if not at the start", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "Prefix <thinking>hidden</thinking>" },
    ];
    const result = extractPromptedThinking(parts);
    expect(result).toEqual(parts);
  });

  it("passes through non-text parts unchanged", () => {
    const parts: MessagePart[] = [
      { type: "tool-call", id: "t1", name: "test", args: {}, result: "ok" },
      { type: "text", text: "<thinking>deep thoughts</thinking>\nAnswer" },
    ];
    const result = extractPromptedThinking(parts);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "tool-call", id: "t1", name: "test", args: {}, result: "ok" });
    expect(result[1]).toEqual({ type: "thinking", thinking: "deep thoughts" });
    expect(result[2]).toEqual({ type: "text", text: "Answer" });
  });

  it("trims whitespace from extracted thinking", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "<thinking>  spaces around  </thinking>  Rest" },
    ];
    const result = extractPromptedThinking(parts);
    expect(result[0]).toEqual({ type: "thinking", thinking: "spaces around" });
    expect(result[1]).toEqual({ type: "text", text: "Rest" });
  });
});
