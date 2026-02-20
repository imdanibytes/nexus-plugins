import { useEffect, useState } from "react";
import { Thread } from "./components/chat/Thread.js";
import { TaskPanel } from "./components/chat/TaskPanel.js";
import { TopBar } from "./components/chat/TopBar.js";
import { ThreadDrawer } from "./components/chat/ThreadDrawer.js";
import { SettingsPage } from "./components/settings/SettingsPage.js";
import { useChatStore } from "./stores/chatStore.js";
import { useThreadListStore } from "./stores/threadListStore.js";
import { useMcpTurnStore } from "./stores/mcpTurnStore.js";
import { useTaskStore } from "./stores/taskStore.js";
import { eventBus } from "./runtime/event-bus.js";
import {
  fetchAgents,
  fetchProviders,
  fetchAvailableTools,
  getActiveAgent,
} from "./api/client.js";
import { injectDevFixtures } from "./lib/dev-fixtures.js";

const USE_DEV_FIXTURES = import.meta.env.DEV && import.meta.env.VITE_DEV_FIXTURES === "true";

function NexusApp() {
  const { setAgents, setActiveAgentId, setProviders, setAvailableTools } =
    useChatStore();
  const { settingsOpen } = useChatStore();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Dev fixtures — bypass API calls and inject dummy data
  useEffect(() => {
    if (USE_DEV_FIXTURES) {
      injectDevFixtures();
      return;
    }
    fetchAgents().then(setAgents);
    fetchProviders().then(setProviders);
    fetchAvailableTools().then(setAvailableTools);
    getActiveAgent().then((r) => setActiveAgentId(r.agentId));
  }, [setAgents, setActiveAgentId, setProviders, setAvailableTools]);

  // Load thread list on startup
  useEffect(() => {
    if (USE_DEV_FIXTURES) return;
    useThreadListStore.getState().loadThreads();
  }, []);

  // Connect EventSource and register broadcast handlers
  useEffect(() => {
    if (USE_DEV_FIXTURES) return;
    eventBus.connect();

    const unsubTools = eventBus.on("tools_changed", () => {
      fetchAvailableTools().then(setAvailableTools);
    });

    const unsubMcpPending = eventBus.on("mcp_turn_pending", (event) => {
      const { conversationId, userMessage } = event.value as {
        conversationId: string;
        userMessage: string;
      };
      useThreadListStore
        .getState()
        .ensureThread(conversationId, userMessage.slice(0, 60) + (userMessage.length > 60 ? "..." : ""));
      useMcpTurnStore
        .getState()
        .setPendingTurn(conversationId, userMessage);
    });

    const unsubConvChanged = eventBus.on("conversations_changed", () => {
      useThreadListStore.getState().loadThreads();
    });

    const unsubTasks = eventBus.on("task_state_changed", (event) => {
      const { conversationId, plan, tasks, mode } = event.value as {
        conversationId: string;
        plan: unknown;
        tasks: Record<string, unknown>;
        mode?: string;
      };
      useTaskStore.getState().setTaskState(conversationId, {
        plan: plan as import("./api/client.js").Plan | null,
        tasks: tasks as Record<string, import("./api/client.js").Task>,
        mode: (mode as import("./api/client.js").AgentMode) ?? "general",
      });
    });

    return () => {
      unsubTools();
      unsubMcpPending();
      unsubConvChanged();
      unsubTasks();
      eventBus.disconnect();
    };
  }, [setAvailableTools]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-default-100/60 dark:bg-default-50/40 backdrop-blur-xl border border-default-200 dark:border-default-200/50">

      {/* Top bar */}
      <TopBar onMenuPress={() => setDrawerOpen(true)} />

      {/* Main content — conversation + task panel as sibling cards */}
      <div className="flex flex-1 min-h-0 gap-2 p-2">
        <div className="flex-1 min-w-0">
          <Thread />
        </div>
        <TaskPanel />
      </div>

      {/* Thread drawer overlay */}
      <ThreadDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Settings modal overlay */}
      {settingsOpen && <SettingsPage />}
    </div>
  );
}

export function App() {
  return <NexusApp />;
}
