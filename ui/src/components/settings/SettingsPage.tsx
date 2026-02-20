import { useState, useEffect, useCallback } from "react";
import { Bot, Database, Server, Wrench, XIcon } from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { useChatStore } from "@/stores/chatStore.js";
import { AgentsTab } from "./AgentsTab.js";
import { ProvidersTab } from "./ProvidersTab.js";
import { ToolsTab } from "./ToolsTab.js";
import { DataTab } from "./DataTab.js";
import { cn } from "@imdanibytes/nexus-ui";

type SettingsTab = "agents" | "providers" | "tools" | "data";

const TABS: { id: SettingsTab; label: string; icon: typeof Bot }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "providers", label: "Providers", icon: Server },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "data", label: "Data", icon: Database },
];

export function SettingsPage() {
  const { setSettingsOpen } = useChatStore();
  const [active, setActive] = useState<SettingsTab>("agents");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    },
    [setSettingsOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        <m.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />

          {/* Modal */}
          <m.div
            className="relative z-10 flex h-[85vh] w-[min(90vw,56rem)] gap-2 p-2"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {/* Nav card */}
            <nav className="w-[200px] shrink-0 rounded-xl bg-default-100 dark:bg-default-50/40 backdrop-blur-xl border border-default-200 dark:border-default-200/50 p-4 flex flex-col gap-1">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Settings</h2>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="p-1 rounded hover:bg-default-200/40 transition-colors text-default-400 hover:text-default-900"
                >
                  <XIcon className="size-4" />
                </button>
              </div>

              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = active === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActive(tab.id)}
                    className={cn(
                      "relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-left transition-colors duration-200",
                      isActive
                        ? "text-foreground font-medium"
                        : "text-default-500 hover:text-default-900 hover:bg-default-200/40",
                    )}
                  >
                    {isActive && (
                      <m.div
                        layoutId="settings-nav"
                        className="absolute inset-0 rounded-xl bg-default-100"
                        transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                      />
                    )}
                    <span className="relative flex items-center gap-3">
                      <Icon size={15} strokeWidth={1.5} />
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Content card */}
            <div className="flex-1 min-h-0 rounded-xl bg-default-100 dark:bg-default-50/40 backdrop-blur-xl border border-default-200 dark:border-default-200/50 overflow-y-auto p-8">
              <AnimatePresence mode="wait">
                <m.div
                  key={active}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <div className="max-w-lg">
                    {active === "agents" && <AgentsTab />}
                    {active === "providers" && <ProvidersTab />}
                    {active === "tools" && <ToolsTab />}
                    {active === "data" && <DataTab />}
                  </div>
                </m.div>
              </AnimatePresence>
            </div>
          </m.div>
        </m.div>
      </AnimatePresence>
    </LazyMotion>
  );
}
