import type { TurnStrategy, TurnStrategyContext, TurnStrategyResult } from "./types.js";
import { executeRoundLoop } from "./round-loop.js";

/**
 * Default strategy: the current round loop behavior with no post-round hooks.
 * Identical to the pre-extraction inline while loop in agent.ts.
 */
export class DefaultStrategy implements TurnStrategy {
  readonly name = "default";

  async execute(ctx: TurnStrategyContext): Promise<TurnStrategyResult> {
    return executeRoundLoop(ctx);
  }
}
