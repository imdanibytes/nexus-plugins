import { useState, useEffect } from "react";
import {
  Save, Trash2, ArrowLeft, Loader2,
} from "lucide-react";
import {
  createAgentApi,
  updateAgentApi,
  deleteAgentApi,
  probeProviderApi,
  type Agent,
  type ProviderPublic,
  type ModelInfo,
  type ToolFilter,
} from "@/api/client.js";
import { useChatStore } from "@/stores/chatStore.js";
import {
  Button,
  Input,
  Textarea,
  Divider,
  Select,
  SelectItem,
} from "@heroui/react";

interface Props {
  agent?: Agent;
  providers: ProviderPublic[];
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

type FilterMode = "all" | "allow" | "deny";

export function AgentEditor({ agent, providers, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(agent?.name || "");
  const [providerId, setProviderId] = useState(agent?.providerId || providers[0]?.id || "");
  const [model, setModel] = useState(agent?.model || "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt || "");
  const [samplingMode, setSamplingMode] = useState<"temperature" | "top_p">(
    agent?.topP !== undefined && agent?.temperature === undefined ? "top_p" : "temperature",
  );
  const [temperature, setTemperature] = useState(agent?.temperature ?? 1);
  const [maxTokens, setMaxTokens] = useState(agent?.maxTokens ?? 8192);
  const [topP, setTopP] = useState(agent?.topP ?? 1);
  const [filterMode, setFilterMode] = useState<FilterMode>(
    agent?.toolFilter?.mode || "all",
  );
  const [filterTools, setFilterTools] = useState<Set<string>>(
    new Set(agent?.toolFilter?.tools || []),
  );
  const [saving, setSaving] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [toolSearch, setToolSearch] = useState("");
  const { availableTools } = useChatStore();

  useEffect(() => {
    if (!providerId) return;
    probeProviderApi(providerId)
      .then((status) => {
        if (status.reachable) setDiscoveredModels(status.models);
      })
      .catch(() => {});
  }, [providerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !providerId || !model.trim()) return;
    setSaving(true);
    try {
      const toolFilter: ToolFilter | undefined =
        filterMode === "all"
          ? undefined
          : { mode: filterMode, tools: Array.from(filterTools) };

      const data = {
        name: name.trim(),
        providerId,
        model: model.trim(),
        systemPrompt: systemPrompt.trim(),
        ...(samplingMode === "temperature"
          ? { temperature, topP: null }
          : { temperature: null, topP }),
        maxTokens,
        toolFilter,
      };

      if (agent) {
        await updateAgentApi(agent.id, data);
      } else {
        await createAgentApi(data);
      }
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    await deleteAgentApi(agent.id);
    onDelete?.();
  };

  const toggleTool = (toolName: string) => {
    setFilterTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  };

  const filteredTools = availableTools.filter(
    (t) =>
      !toolSearch || t.name.toLowerCase().includes(toolSearch.toLowerCase()),
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="light" isIconOnly size="sm" onPress={onCancel} className="h-7 w-7 min-w-7">
          <ArrowLeft size={14} />
        </Button>
        <div>
          <h3 className="text-sm font-medium">
            {agent ? "Edit Agent" : "New Agent"}
          </h3>
          <p className="text-[11px] text-default-500">
            {agent ? "Update this agent's configuration." : "Create a new agent configuration."}
          </p>
        </div>
      </div>

      <Divider />

      <Input
        label="Name"
        labelPlacement="outside"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Research Assistant"
        isRequired
        size="sm"
      />

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Provider</label>
        {providers.length === 0 ? (
          <p className="text-xs text-default-500">
            No providers configured. Add one in the Providers tab first.
          </p>
        ) : (
          <Select
            selectedKeys={[providerId]}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as string;
              if (key) setProviderId(key);
            }}
            size="sm"
            aria-label="Provider"
          >
            {providers.map((p) => (
              <SelectItem key={p.id}>{p.name}</SelectItem>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Input
          label="Model"
          labelPlacement="outside"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="qwen3:30b"
          list={discoveredModels.length > 0 ? "agent-model-options" : undefined}
          isRequired
          classNames={{ input: "font-mono text-xs" }}
          size="sm"
        />
        {discoveredModels.length > 0 && (
          <datalist id="agent-model-options">
            {discoveredModels.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
        )}
        <p className="text-[11px] text-default-500">
          {discoveredModels.length > 0
            ? `${discoveredModels.length} model${discoveredModels.length !== 1 ? "s" : ""} discovered.`
            : "Enter a model ID."}
        </p>
      </div>

      <Textarea
        label="System Prompt"
        labelPlacement="outside"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="You are a helpful assistant..."
        minRows={4}
        classNames={{ input: "text-xs" }}
        size="sm"
      />

      <Divider />

      <div className="space-y-4">
        <h4 className="text-xs font-medium text-default-500 uppercase tracking-wide">
          Model Parameters
        </h4>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Sampling Method</label>
          <Select
            selectedKeys={[samplingMode]}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as "temperature" | "top_p";
              if (key) setSamplingMode(key);
            }}
            size="sm"
            aria-label="Sampling method"
          >
            <SelectItem key="temperature">Temperature</SelectItem>
            <SelectItem key="top_p">Top P</SelectItem>
          </Select>
        </div>

        {samplingMode === "temperature" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Temperature</label>
              <span className="text-xs text-default-500 font-mono">{temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Top P</label>
              <span className="text-xs text-default-500 font-mono">{topP.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        )}

        <Input
          label="Max Tokens"
          labelPlacement="outside"
          type="number"
          value={String(maxTokens)}
          onChange={(e) => setMaxTokens(parseInt(e.target.value) || 8192)}
          classNames={{ input: "font-mono text-xs" }}
          size="sm"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-default-500 uppercase tracking-wide">
          Tool Access
        </h4>

        <Select
          selectedKeys={[filterMode]}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0] as FilterMode;
            if (key) setFilterMode(key);
          }}
          size="sm"
          aria-label="Tool filter mode"
        >
          <SelectItem key="all">All tools</SelectItem>
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
                  </label>
                ))
              )}
            </div>
            <p className="text-[11px] text-default-500">
              {filterMode === "allow"
                ? "Only checked tools will be available."
                : "Checked tools will be blocked."}
            </p>
          </div>
        )}
      </div>

      <Divider />

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          color="primary"
          size="sm"
          isDisabled={!name.trim() || !providerId || !model.trim() || saving}
          className="gap-1.5"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </Button>
        <Button type="button" variant="light" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        {agent && onDelete && (
          <Button
            type="button"
            variant="light"
            size="sm"
            onPress={handleDelete}
            className="ml-auto text-danger hover:text-danger gap-1.5"
          >
            <Trash2 size={13} />
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
