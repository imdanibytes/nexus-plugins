import { describe, it, expect, vi } from "vitest";
import { SystemMessageBuilder } from "../../src/system-message/builder.js";
import type { SystemMessageProvider, SystemMessageContext } from "../../src/system-message/types.js";

// ── Helpers ──

function makeProvider(
  name: string,
  result: string | null,
  delay = 0,
): SystemMessageProvider {
  return {
    name,
    timeoutMs: 5000,
    provide: vi.fn(async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return result;
    }),
  };
}

function makeFailingProvider(name: string, error: string): SystemMessageProvider {
  return {
    name,
    timeoutMs: 5000,
    provide: vi.fn(async () => {
      throw new Error(error);
    }),
  };
}

function makeTimingOutProvider(name: string): SystemMessageProvider {
  return {
    name,
    timeoutMs: 10, // very short timeout
    provide: vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5000)),
    ),
  };
}

function makeCtx(): SystemMessageContext {
  return {
    conversationId: "conv-1",
    conversation: {} as any,
    toolNames: [],
    settings: {} as any,
  };
}

// ── Tests ──

describe("SystemMessageBuilder", () => {
  describe("register", () => {
    it("accepts providers without error", () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeProvider("test", "hello"));
      // No assertion needed — just ensure it doesn't throw
    });
  });

  describe("build", () => {
    it("returns empty string with no providers", async () => {
      const builder = new SystemMessageBuilder();
      const result = await builder.build(makeCtx());
      expect(result).toBe("");
    });

    it("joins provider results with double newlines", async () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeProvider("a", "Section A"));
      builder.register(makeProvider("b", "Section B"));
      builder.register(makeProvider("c", "Section C"));

      const result = await builder.build(makeCtx());
      expect(result).toBe("Section A\n\nSection B\n\nSection C");
    });

    it("skips providers that return null", async () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeProvider("a", "Section A"));
      builder.register(makeProvider("skip", null));
      builder.register(makeProvider("c", "Section C"));

      const result = await builder.build(makeCtx());
      expect(result).toBe("Section A\n\nSection C");
    });

    it("skips providers that throw errors", async () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeProvider("a", "Section A"));
      builder.register(makeFailingProvider("broken", "kaboom"));
      builder.register(makeProvider("c", "Section C"));

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await builder.build(makeCtx());
      warnSpy.mockRestore();

      expect(result).toBe("Section A\n\nSection C");
    });

    it("logs a warning when a provider fails", async () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeFailingProvider("broken", "kaboom"));

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await builder.build(makeCtx());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"broken"'),
        expect.stringContaining("kaboom"),
      );
      warnSpy.mockRestore();
    });

    it("respects provider timeout", async () => {
      const builder = new SystemMessageBuilder();
      builder.register(makeProvider("fast", "Fast result"));
      builder.register(makeTimingOutProvider("slow"));

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await builder.build(makeCtx());
      warnSpy.mockRestore();

      // Slow provider times out → null → skipped
      expect(result).toBe("Fast result");
    });

    it("passes context to each provider", async () => {
      const builder = new SystemMessageBuilder();
      const provider = makeProvider("spy", "ok");
      builder.register(provider);

      const ctx = makeCtx();
      await builder.build(ctx);

      expect(provider.provide).toHaveBeenCalledWith(ctx);
    });

    it("calls all providers in parallel", async () => {
      const builder = new SystemMessageBuilder();
      const timings: number[] = [];
      const start = Date.now();

      // Two providers that each take 50ms — if parallel, total < 150ms
      builder.register({
        name: "p1",
        timeoutMs: 5000,
        provide: async () => {
          await new Promise((r) => setTimeout(r, 50));
          timings.push(Date.now() - start);
          return "P1";
        },
      });
      builder.register({
        name: "p2",
        timeoutMs: 5000,
        provide: async () => {
          await new Promise((r) => setTimeout(r, 50));
          timings.push(Date.now() - start);
          return "P2";
        },
      });

      await builder.build(makeCtx());

      // Both should complete around the same time (within 50ms of each other)
      expect(Math.abs(timings[0] - timings[1])).toBeLessThan(40);
    });
  });
});
