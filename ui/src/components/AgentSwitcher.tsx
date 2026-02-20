import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { useChatStore } from "@/stores/chatStore.js";
import { setActiveAgent as apiSetActive } from "@/api/client.js";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import { cn } from "@imdanibytes/nexus-ui";

export function AgentSwitcher() {
  const { agents, activeAgentId, setActiveAgentId, providers } = useChatStore();
  const [open, setOpen] = useState(false);

  const activeAgent = agents.find((a) => a.id === activeAgentId);

  const handleSelect = async (id: string | null) => {
    setActiveAgentId(id);
    setOpen(false);
    await apiSetActive(id);
  };

  if (agents.length === 0) return null;

  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="top-start">
      <PopoverTrigger>
        <Button
          variant="light"
          size="sm"
          className="h-7 gap-1 text-xs text-default-500 hover:text-default-900 px-2 flex-shrink-0"
        >
          {activeAgent ? (
            <span className="max-w-[80px] truncate">{activeAgent.name}</span>
          ) : (
            <span>Default</span>
          )}
          <ChevronsUpDown size={11} className="text-default-400" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-1">
        <div className="space-y-0.5">
          <button
            onClick={() => handleSelect(null)}
            className={cn(
              "w-full text-left px-3 py-2 text-xs rounded-md transition-colors flex items-center gap-2",
              !activeAgentId
                ? "bg-default-200/50 text-default-900"
                : "hover:bg-default-100/40 text-default-900"
            )}
          >
            <span className="flex-1">Default</span>
            {!activeAgentId && <Check size={12} className="text-primary" />}
          </button>

          {agents.map((a) => {
            const isActive = activeAgentId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => handleSelect(a.id)}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs rounded-md transition-colors flex items-center gap-2",
                  isActive
                    ? "bg-default-200/50 text-default-900"
                    : "hover:bg-default-100/40 text-default-900"
                )}
              >
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-[10px] text-default-500 font-mono truncate max-w-[80px]">
                  {a.model}
                </span>
                {isActive && <Check size={12} className="text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
