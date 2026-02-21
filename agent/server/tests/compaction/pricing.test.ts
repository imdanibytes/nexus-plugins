import { describe, it, expect } from "vitest";
import { resolvePrice, calculateCost } from "../../src/compaction/pricing.js";

describe("resolvePrice", () => {
  describe("Anthropic models", () => {
    it("resolves claude-opus-4 pricing", () => {
      expect(resolvePrice("claude-opus-4-20250514")).toEqual({
        inputPer1M: 15,
        outputPer1M: 75,
      });
    });

    it("resolves claude-sonnet-4 pricing", () => {
      expect(resolvePrice("claude-sonnet-4-20250514")).toEqual({
        inputPer1M: 3,
        outputPer1M: 15,
      });
    });

    it("resolves claude-3-5-sonnet pricing", () => {
      expect(resolvePrice("claude-3-5-sonnet-20241022")).toEqual({
        inputPer1M: 3,
        outputPer1M: 15,
      });
    });

    it("resolves claude-3-5-haiku pricing", () => {
      expect(resolvePrice("claude-3-5-haiku-20241022")).toEqual({
        inputPer1M: 0.80,
        outputPer1M: 4,
      });
    });

    it("resolves claude-3-opus pricing", () => {
      expect(resolvePrice("claude-3-opus-20240229")).toEqual({
        inputPer1M: 15,
        outputPer1M: 75,
      });
    });

    it("resolves claude-3-haiku pricing", () => {
      expect(resolvePrice("claude-3-haiku-20240307")).toEqual({
        inputPer1M: 0.25,
        outputPer1M: 1.25,
      });
    });
  });

  describe("Bedrock-prefixed models", () => {
    it("strips anthropic. prefix", () => {
      expect(resolvePrice("anthropic.claude-sonnet-4-20250514-v1:0")).toEqual({
        inputPer1M: 3,
        outputPer1M: 15,
      });
    });

    it("strips version suffix", () => {
      expect(resolvePrice("anthropic.claude-3-5-sonnet-20241022-v2:0")).toEqual({
        inputPer1M: 3,
        outputPer1M: 15,
      });
    });
  });

  describe("OpenAI models", () => {
    it("resolves gpt-4o pricing", () => {
      expect(resolvePrice("gpt-4o")).toEqual({
        inputPer1M: 2.50,
        outputPer1M: 10,
      });
    });

    it("resolves gpt-4o-mini pricing (exact match takes priority)", () => {
      expect(resolvePrice("gpt-4o-mini")).toEqual({
        inputPer1M: 0.15,
        outputPer1M: 0.60,
      });
    });

    it("resolves gpt-4-turbo pricing", () => {
      expect(resolvePrice("gpt-4-turbo")).toEqual({
        inputPer1M: 10,
        outputPer1M: 30,
      });
    });

    it("resolves gpt-3.5-turbo pricing", () => {
      expect(resolvePrice("gpt-3.5-turbo")).toEqual({
        inputPer1M: 0.50,
        outputPer1M: 1.50,
      });
    });
  });

  describe("unknown models", () => {
    it("returns zero pricing for unknown model", () => {
      expect(resolvePrice("llama-3-70b")).toEqual({
        inputPer1M: 0,
        outputPer1M: 0,
      });
    });

    it("returns zero pricing for empty string", () => {
      expect(resolvePrice("")).toEqual({
        inputPer1M: 0,
        outputPer1M: 0,
      });
    });
  });
});

describe("calculateCost", () => {
  it("calculates cost for given token counts and pricing", () => {
    const pricing = { inputPer1M: 3, outputPer1M: 15 };
    // 1M input tokens × $3/1M + 500K output tokens × $15/1M = $3 + $7.5 = $10.5
    expect(calculateCost(1_000_000, 500_000, pricing)).toBeCloseTo(10.5);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost(0, 0, { inputPer1M: 15, outputPer1M: 75 })).toBe(0);
  });

  it("returns 0 for zero pricing", () => {
    expect(calculateCost(100_000, 50_000, { inputPer1M: 0, outputPer1M: 0 })).toBe(0);
  });

  it("handles small token counts correctly", () => {
    const pricing = { inputPer1M: 3, outputPer1M: 15 };
    // 1000 input × $3/1M = $0.003, 500 output × $15/1M = $0.0075
    expect(calculateCost(1000, 500, pricing)).toBeCloseTo(0.0105);
  });
});
