/**
 * Loop detection for the agent tool-use round loop.
 *
 * Detects two patterns:
 * 1. Textless rounds — consecutive rounds where the model only makes tool calls
 *    without producing any text. Nudge at 3, hard-break at 5.
 * 2. Repetition — consecutive rounds with identical tool call signatures,
 *    indicating the agent is stuck in a loop. Nudge immediately.
 */

export interface LoopGuardState {
  textlessRounds: number;
  /** Tool names from recent rounds, newest last */
  recentToolNames: string[][];
}

export interface LoopGuardResult {
  action: "continue" | "nudge" | "break";
  reason?: "textless" | "repetition" | "max_textless";
  message?: string;
}

const NUDGE_THRESHOLD = 3;
const BREAK_THRESHOLD = 5;

/**
 * Check whether the round loop should nudge or break.
 */
export function checkLoopGuard(state: LoopGuardState): LoopGuardResult {
  // Hard break at threshold
  if (state.textlessRounds >= BREAK_THRESHOLD) {
    return {
      action: "break",
      reason: "max_textless",
    };
  }

  // Repetition detection: last 2 rounds have identical tool call signatures
  if (state.recentToolNames.length >= 2) {
    const last = state.recentToolNames[state.recentToolNames.length - 1];
    const prev = state.recentToolNames[state.recentToolNames.length - 2];
    if (
      last.length > 0 &&
      last.length === prev.length &&
      last.every((name, i) => name === prev[i])
    ) {
      return {
        action: "nudge",
        reason: "repetition",
        message:
          "You appear to be repeating the same tool calls. Stop and reassess your approach. " +
          "If you're stuck, explain what you've tried and what's blocking you.",
      };
    }
  }

  // Textless nudge at threshold
  if (state.textlessRounds >= NUDGE_THRESHOLD) {
    return {
      action: "nudge",
      reason: "textless",
      message:
        `You've made ${state.textlessRounds} consecutive tool calls without providing any text to the user. ` +
        "Pause and briefly summarize your progress so far before continuing.",
    };
  }

  return { action: "continue" };
}

/** Create a fresh loop guard state. */
export function createLoopGuardState(): LoopGuardState {
  return { textlessRounds: 0, recentToolNames: [] };
}

/** Update loop guard state after a round. */
export function updateLoopGuard(
  state: LoopGuardState,
  hadText: boolean,
  toolNames: string[],
): void {
  if (hadText) {
    state.textlessRounds = 0;
  } else {
    state.textlessRounds++;
  }

  state.recentToolNames.push(toolNames);
  // Keep only last 5 rounds
  if (state.recentToolNames.length > 5) {
    state.recentToolNames.shift();
  }
}
