import { describe, it, expect } from "vitest";
import {
  createLoopGuardState,
  updateLoopGuard,
  checkLoopGuard,
  type LoopGuardState,
} from "../../src/mechanics/loop-guard.js";

// ── Helpers ──

function makeState(overrides: Partial<LoopGuardState> = {}): LoopGuardState {
  return { textlessRounds: 0, recentToolNames: [], ...overrides };
}

// ── Tests ──

describe("createLoopGuardState", () => {
  it("returns a fresh state with zero counters", () => {
    const state = createLoopGuardState();
    expect(state).toEqual({ textlessRounds: 0, recentToolNames: [] });
  });

  it("returns a new object each call", () => {
    const a = createLoopGuardState();
    const b = createLoopGuardState();
    expect(a).not.toBe(b);
  });
});

describe("updateLoopGuard", () => {
  it("increments textlessRounds when hadText is false", () => {
    const state = makeState();
    updateLoopGuard(state, false, ["tool_a"]);
    expect(state.textlessRounds).toBe(1);
    updateLoopGuard(state, false, ["tool_b"]);
    expect(state.textlessRounds).toBe(2);
  });

  it("resets textlessRounds when hadText is true", () => {
    const state = makeState({ textlessRounds: 4 });
    updateLoopGuard(state, true, ["tool_a"]);
    expect(state.textlessRounds).toBe(0);
  });

  it("appends tool names to recentToolNames", () => {
    const state = makeState();
    updateLoopGuard(state, true, ["read_file", "write_file"]);
    updateLoopGuard(state, false, ["execute_command"]);
    expect(state.recentToolNames).toEqual([
      ["read_file", "write_file"],
      ["execute_command"],
    ]);
  });

  it("keeps only the last 5 rounds of tool names", () => {
    const state = makeState();
    for (let i = 0; i < 7; i++) {
      updateLoopGuard(state, false, [`tool_${i}`]);
    }
    expect(state.recentToolNames).toHaveLength(5);
    expect(state.recentToolNames[0]).toEqual(["tool_2"]);
    expect(state.recentToolNames[4]).toEqual(["tool_6"]);
  });

  it("stores empty tool arrays without issue", () => {
    const state = makeState();
    updateLoopGuard(state, true, []);
    expect(state.recentToolNames).toEqual([[]]);
  });
});

describe("checkLoopGuard", () => {
  describe("continue", () => {
    it("returns continue for fresh state", () => {
      expect(checkLoopGuard(makeState())).toEqual({ action: "continue" });
    });

    it("returns continue below nudge threshold", () => {
      expect(checkLoopGuard(makeState({ textlessRounds: 2 }))).toEqual({
        action: "continue",
      });
    });

    it("returns continue when last two rounds differ", () => {
      const state = makeState({
        recentToolNames: [["tool_a"], ["tool_b"]],
      });
      expect(checkLoopGuard(state)).toEqual({ action: "continue" });
    });
  });

  describe("nudge — textless", () => {
    it("nudges at exactly 3 textless rounds", () => {
      const result = checkLoopGuard(makeState({ textlessRounds: 3 }));
      expect(result.action).toBe("nudge");
      expect(result.reason).toBe("textless");
      expect(result.message).toContain("3 consecutive tool calls");
    });

    it("nudges at 4 textless rounds", () => {
      const result = checkLoopGuard(makeState({ textlessRounds: 4 }));
      expect(result.action).toBe("nudge");
      expect(result.reason).toBe("textless");
    });
  });

  describe("nudge — repetition", () => {
    it("nudges when last 2 rounds have identical tool lists", () => {
      const state = makeState({
        recentToolNames: [["read_file", "write_file"], ["read_file", "write_file"]],
      });
      const result = checkLoopGuard(state);
      expect(result.action).toBe("nudge");
      expect(result.reason).toBe("repetition");
      expect(result.message).toContain("repeating the same tool calls");
    });

    it("does not nudge when tool lists differ in order", () => {
      const state = makeState({
        recentToolNames: [["a", "b"], ["b", "a"]],
      });
      expect(checkLoopGuard(state).action).toBe("continue");
    });

    it("does not nudge when tool lists differ in length", () => {
      const state = makeState({
        recentToolNames: [["a", "b"], ["a"]],
      });
      expect(checkLoopGuard(state).action).toBe("continue");
    });

    it("does not nudge on empty tool lists (both empty)", () => {
      const state = makeState({
        recentToolNames: [[], []],
      });
      // Empty tool lists → last.length is 0, so condition `last.length > 0` fails
      expect(checkLoopGuard(state).action).toBe("continue");
    });

    it("does not nudge with only one round of history", () => {
      const state = makeState({
        recentToolNames: [["tool_a"]],
      });
      expect(checkLoopGuard(state).action).toBe("continue");
    });

    it("only compares the last 2 rounds, ignoring older history", () => {
      const state = makeState({
        recentToolNames: [["tool_a"], ["tool_a"], ["tool_b"]],
      });
      // Last two: ["tool_a"] and ["tool_b"] — different
      expect(checkLoopGuard(state).action).toBe("continue");
    });
  });

  describe("break", () => {
    it("breaks at exactly 5 textless rounds", () => {
      const result = checkLoopGuard(makeState({ textlessRounds: 5 }));
      expect(result.action).toBe("break");
      expect(result.reason).toBe("max_textless");
    });

    it("breaks above 5 textless rounds", () => {
      const result = checkLoopGuard(makeState({ textlessRounds: 10 }));
      expect(result.action).toBe("break");
      expect(result.reason).toBe("max_textless");
    });
  });

  describe("priority", () => {
    it("break takes priority over repetition nudge", () => {
      const state = makeState({
        textlessRounds: 5,
        recentToolNames: [["a"], ["a"]],
      });
      const result = checkLoopGuard(state);
      expect(result.action).toBe("break");
      expect(result.reason).toBe("max_textless");
    });

    it("repetition nudge takes priority over textless nudge", () => {
      const state = makeState({
        textlessRounds: 3,
        recentToolNames: [["a"], ["a"]],
      });
      const result = checkLoopGuard(state);
      expect(result.action).toBe("nudge");
      expect(result.reason).toBe("repetition");
    });
  });
});
