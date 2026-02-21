import { describe, it, expect } from "vitest";
import { supportsNativeThinking, resolveThinkingConfig } from "../src/thinking.js";
import type { TurnConfig } from "../src/turn-config.js";

// ── Helpers ──

function makeConfig(overrides: Partial<TurnConfig> = {}): TurnConfig {
  return {
    client: {} as any,
    model: "claude-sonnet-4-20250514",
    maxTokens: 8192,
    provider: { type: "anthropic" },
    ...overrides,
  } as TurnConfig;
}

// ── Tests ──

describe("supportsNativeThinking", () => {
  describe("positive matches", () => {
    const supported = [
      "claude-3-7-sonnet-20250219",
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-20250514",
      "anthropic.claude-opus-4-20250514-v1:0",
    ];

    for (const model of supported) {
      it(`returns true for ${model} with anthropic provider`, () => {
        expect(supportsNativeThinking(model, "anthropic")).toBe(true);
      });
    }

    it("returns true for bedrock provider", () => {
      expect(supportsNativeThinking("claude-sonnet-4-20250514", "bedrock")).toBe(true);
    });
  });

  describe("negative matches", () => {
    const unsupported = [
      "claude-3-5-sonnet-20241022",
      "claude-3-haiku-20240307",
      "gpt-4o",
      "gemini-pro",
    ];

    for (const model of unsupported) {
      it(`returns false for ${model}`, () => {
        expect(supportsNativeThinking(model, "anthropic")).toBe(false);
      });
    }
  });

  describe("provider filtering", () => {
    it("returns false for openai-compatible provider even with supported model", () => {
      expect(supportsNativeThinking("claude-sonnet-4-20250514", "openai-compatible")).toBe(false);
    });

    it("returns false when provider is undefined", () => {
      expect(supportsNativeThinking("claude-sonnet-4-20250514")).toBe(false);
    });

    it("returns false when provider is undefined even for supported model", () => {
      expect(supportsNativeThinking("claude-opus-4-20250514", undefined)).toBe(false);
    });
  });
});

describe("resolveThinkingConfig", () => {
  it("returns undefined when no agent config", () => {
    expect(resolveThinkingConfig(makeConfig())).toBeUndefined();
  });

  it("returns undefined when agent has no thinking config", () => {
    expect(resolveThinkingConfig(makeConfig({ agent: { thinking: undefined } as any }))).toBeUndefined();
  });

  it("returns undefined for disabled mode", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "disabled" } } as any,
    });
    expect(resolveThinkingConfig(config)).toBeUndefined();
  });

  it("returns enabled with budget for native mode on supported model", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "native", budgetTokens: 20000 } } as any,
    });
    const result = resolveThinkingConfig(config);
    expect(result).toEqual({ type: "enabled", budget_tokens: 20000 });
  });

  it("returns enabled with default budget when budgetTokens is not set", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "native" } } as any,
    });
    const result = resolveThinkingConfig(config);
    expect(result).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("enforces minimum budget of 1024", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "native", budgetTokens: 500 } } as any,
    });
    const result = resolveThinkingConfig(config);
    expect(result).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("returns enabled for auto mode on supported model", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "auto", budgetTokens: 15000 } } as any,
    });
    const result = resolveThinkingConfig(config);
    expect(result).toEqual({ type: "enabled", budget_tokens: 15000 });
  });

  it("returns undefined for auto mode on unsupported model", () => {
    const config = makeConfig({
      model: "gpt-4o",
      provider: { type: "openai-compatible" } as any,
      agent: { thinking: { mode: "auto", budgetTokens: 15000 } } as any,
    });
    expect(resolveThinkingConfig(config)).toBeUndefined();
  });

  it("returns undefined for native mode on unsupported model", () => {
    const config = makeConfig({
      model: "claude-3-5-sonnet-20241022",
      agent: { thinking: { mode: "native", budgetTokens: 15000 } } as any,
    });
    expect(resolveThinkingConfig(config)).toBeUndefined();
  });

  it("returns undefined for prompted mode (handled by system message)", () => {
    const config = makeConfig({
      agent: { thinking: { mode: "prompted" } } as any,
    });
    expect(resolveThinkingConfig(config)).toBeUndefined();
  });
});
