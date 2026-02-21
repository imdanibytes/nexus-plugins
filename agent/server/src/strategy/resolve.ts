import type { RoundLoopCallbacks } from "./types.js";
import type { ExecutionStrategyConfig } from "../types.js";
import { EnhancedStrategy } from "./enhanced.js";

/**
 * Resolve after-round callbacks for the graph runtime.
 * Default strategy has no callbacks. Enhanced strategy provides
 * self-critique and verification hooks.
 */
export function resolveCallbacks(
  config?: ExecutionStrategyConfig | null,
): RoundLoopCallbacks | undefined {
  if (!config || config.type === "default") return undefined;

  if (config.type === "enhanced") {
    return new EnhancedStrategy(config).getCallbacks();
  }

  return undefined;
}
