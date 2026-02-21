import { useState } from "react";
import { Bot, Database, Server, Wrench } from "lucide-react";
import { SettingsShell } from "@imdanibytes/nexus-ui";
import type { SettingsTab as SettingsTabType } from "@imdanibytes/nexus-ui";
import { useChatStore } from "@/stores/chatStore.js";
import { AgentsTab } from "./AgentsTab.js";
import { ProvidersTab } from "./ProvidersTab.js";
import { ToolsTab } from "./ToolsTab.js";
import { DataTab } from "./DataTab.js";

type TabId = "agents" | "providers" | "tools" | "data";

const TABS: SettingsTabType[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "providers", label: "Providers", icon: Server },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "data", label: "Data", icon: Database },
];

const TAB_COMPONENTS: Record<TabId, React.FC> = {
  agents: AgentsTab,
  providers: ProvidersTab,
  tools: ToolsTab,
  data: DataTab,
};

export function SettingsPage() {
  const { setSettingsOpen } = useChatStore();
  const [active, setActive] = useState<TabId>("agents");

  const ActiveComponent = TAB_COMPONENTS[active];

  return (
    <SettingsShell
      tabs={TABS}
      activeTab={active}
      onTabChange={(id) => setActive(id as TabId)}
      variant="modal"
      onClose={() => setSettingsOpen(false)}
    >
      <div className="max-w-lg">
        <ActiveComponent />
      </div>
    </SettingsShell>
  );
}
