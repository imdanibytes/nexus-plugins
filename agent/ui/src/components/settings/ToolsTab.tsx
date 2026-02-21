import { useState, useEffect } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import {
  fetchToolSettings,
  updateToolSettingsApi,
  type ToolSettings,
  type ToolFilter,
} from "@/api/client.js";
import { useChatStore } from "@/stores/chatStore.js";
import {
  Button,
  Input,
  Divider,
  Select,
  SelectItem,
} from "@heroui/react";

type FilterMode = "all" | "allow" | "deny";

export function ToolsTab() {
  const { availableTools } = useChatStore();
  const [settings, setSettings] = useState<ToolSettings | null>(null);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterTools, setFilterTools] = useState<Set<string>>(new Set());
  const [toolSearch, setToolSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchToolSettings().then((s) => {
      setSettings(s);
      setPatterns(s.uiHiddenPatterns);
      setFilterMode(s.globalToolFilter?.mode || "all");
      setFilterTools(new Set(s.globalToolFilter?.tools || []));
    });
  }, []);

  const save = async (
    newPatterns?: string[],
    newFilterMode?: FilterMode,
    newFilterTools?: Set<string>,
  ) => {
    setSaving(true);
    try {
      const p = newPatterns ?? patterns;
      const fm = newFilterMode ?? filterMode;
      const ft = newFilterTools ?? filterTools;

      const globalToolFilter: ToolFilter | undefined =
        fm === "all"
          ? undefined
          : { mode: fm, tools: Array.from(ft) };

      const updated = await updateToolSettingsApi({
        uiHiddenPatterns: p,
        globalToolFilter,
      });
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  };

  const addPattern = () => {
    const trimmed = newPattern.trim();
    if (!trimmed || patterns.includes(trimmed)) return;
    const next = [...patterns, trimmed];
    setPatterns(next);
    setNewPattern("");
    save(next);
  };

  const removePattern = (idx: number) => {
    const next = patterns.filter((_, i) => i !== idx);
    setPatterns(next);
    save(next);
  };

  const handleFilterModeChange = (mode: FilterMode) => {
    setFilterMode(mode);
    save(undefined, mode);
  };

  const toggleTool = (toolName: string) => {
    setFilterTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      save(undefined, undefined, next);
      return next;
    });
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin text-default-500" />
      </div>
    );
  }

  const filteredTools = availableTools.filter(
    (t) => !toolSearch || t.name.toLowerCase().includes(toolSearch.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">UI Visibility</h3>
          <p className="text-[11px] text-default-500 mt-0.5">
            Tool calls matching these patterns won't appear in the chat.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Hidden Tool Patterns</label>
          <div className="space-y-1">
            {patterns.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-default-100/30 text-xs font-mono"
              >
                <span className="flex-1 truncate">{p}</span>
                <button
                  onClick={() => removePattern(i)}
                  className="text-default-500 hover:text-danger transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="_nexus_*"
              classNames={{ input: "font-mono text-xs" }}
              size="sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPattern();
                }
              }}
            />
            <Button
              variant="bordered"
              size="sm"
              onPress={addPattern}
              isDisabled={!newPattern.trim()}
              isIconOnly
              className="flex-shrink-0"
            >
              <Plus size={13} />
            </Button>
          </div>
        </div>
      </section>

      <Divider />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Global Tool Filter</h3>
          <p className="text-[11px] text-default-500 mt-0.5">
            Control which tools are available to all agents.
          </p>
        </div>

        <Select
          selectedKeys={[filterMode]}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0] as FilterMode;
            if (key) handleFilterModeChange(key);
          }}
          size="sm"
          aria-label="Filter mode"
        >
          <SelectItem key="all">Allow all tools</SelectItem>
          <SelectItem key="allow">Allow list</SelectItem>
          <SelectItem key="deny">Deny list</SelectItem>
        </Select>

        {filterMode !== "all" && (
          <div className="space-y-2">
            <Input
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder="Search tools..."
              classNames={{ input: "text-xs" }}
              size="sm"
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-default-200/50">
              {filteredTools.length === 0 ? (
                <p className="text-xs text-default-500 p-3">No tools found.</p>
              ) : (
                filteredTools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-default-100/30 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={filterTools.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="accent-primary"
                    />
                    <span className="font-mono truncate flex-1">{tool.name}</span>
                    <span className="text-default-400 text-[10px]">{tool.source}</span>
                  </label>
                ))
              )}
            </div>
            <p className="text-[11px] text-default-500">
              {filterMode === "allow"
                ? "Only checked tools will be available to any agent."
                : "Checked tools will be blocked for all agents."}
            </p>
          </div>
        )}

        {saving && (
          <div className="flex items-center gap-2 text-xs text-default-500">
            <Loader2 size={12} className="animate-spin" />
            Saving...
          </div>
        )}
      </section>
    </div>
  );
}
