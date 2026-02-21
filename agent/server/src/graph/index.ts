export type {
  AgentMode,
  StateNode,
  StateEdge,
  StateGraphDef,
  GraphContext,
  InterruptDef,
  InterruptState,
  TransitionSignal,
  NodeRunResult,
} from "./types.js";

export { AGENT_GRAPH } from "./definition.js";
export { StateGraphEngine } from "./engine.js";
export { AgentGraph } from "./runtime.js";

import { AGENT_GRAPH } from "./definition.js";
import { StateGraphEngine } from "./engine.js";
import { AgentGraph } from "./runtime.js";

/** Singleton engine instance — all mode logic flows through here. */
export const graphEngine = new StateGraphEngine(AGENT_GRAPH);

/** Singleton graph runtime — the agent IS the graph. */
export const agentGraph = new AgentGraph(graphEngine);
