import { create } from "zustand";
import type { Agent, AvailableTool, ProviderPublic } from "../api/client.js";

export type { TimingSpan, TimingSpanMarker } from "@imdanibytes/nexus-ui";

interface ChatState {
  agents: Agent[];
  activeAgentId: string | null;
  providers: ProviderPublic[];
  availableTools: AvailableTool[];
  settingsOpen: boolean;

  setAgents: (agents: Agent[]) => void;
  setActiveAgentId: (id: string | null) => void;
  setProviders: (providers: ProviderPublic[]) => void;
  setAvailableTools: (tools: AvailableTool[]) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  agents: [],
  activeAgentId: null,
  providers: [],
  availableTools: [],
  settingsOpen: false,

  setAgents: (agents) => set({ agents }),
  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
  setProviders: (providers) => set({ providers }),
  setAvailableTools: (availableTools) => set({ availableTools }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
