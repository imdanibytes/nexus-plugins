import { describe, it, expect } from "vitest";
import { resolveCallbacks } from "../../src/strategy/resolve.js";

describe("resolveCallbacks", () => {
  it("returns undefined when config is undefined", () => {
    expect(resolveCallbacks(undefined)).toBeUndefined();
  });

  it("returns undefined when config is null", () => {
    expect(resolveCallbacks(null)).toBeUndefined();
  });

  it("returns undefined for default strategy", () => {
    expect(resolveCallbacks({ type: "default" })).toBeUndefined();
  });

  it("returns callbacks with afterRound for enhanced strategy", () => {
    const callbacks = resolveCallbacks({
      type: "enhanced",
      selfCritique: { enabled: true },
    });
    expect(callbacks).toBeDefined();
    expect(callbacks!.afterRound).toBeTypeOf("function");
  });

  it("returns callbacks even when enhanced sub-features are disabled", () => {
    const callbacks = resolveCallbacks({
      type: "enhanced",
      selfCritique: { enabled: false },
      verification: { enabled: false },
    });
    expect(callbacks).toBeDefined();
    expect(callbacks!.afterRound).toBeTypeOf("function");
  });
});
