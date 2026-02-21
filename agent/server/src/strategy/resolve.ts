import type { TurnStrategy } from "./types.js";
import type { ExecutionStrategyConfig } from "../types.js";
import { DefaultStrategy } from "./default.js";
import { EnhancedStrategy } from "./enhanced.js";

/**
 * Resolve a TurnStrategy from agent config.
 * Undefined/null config -> DefaultStrategy (backward compatible).
 */
export function resolveStrategy(config?: ExecutionStrategyConfig | null): TurnStrategy {
  if (!config || config.type === "default") {
    return new DefaultStrategy();
  }

  if (config.type === "enhanced") {
    return new EnhancedStrategy(config);
  }

  console.warn(`[strategy] unknown strategy type: ${(config as { type: string }).type}, falling back to default`);
  return new DefaultStrategy();
}
