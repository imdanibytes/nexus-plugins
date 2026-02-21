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
  type ModelTierName,
  type RetrievalPrimingConfig,
  type ExecutionStrategyConfig,
  type ThinkingConfig,
  type ThinkingMode,
  MODEL_TIER_NAMES,
  MODEL_TIER_LABELS,
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
  const [retrievalEnabled, setRetrievalEnabled] = useState(agent?.retrievalPriming?.enabled ?? false);
  const [retrievalMaxChars, setRetrievalMaxChars] = useState(agent?.retrievalPriming?.maxChars ?? 8000);
  const [strategyType, setStrategyType] = useState<"default" | "enhanced">(
    agent?.executionStrategy?.type ?? "default",
  );
  const [critiqueEnabled, setCritiqueEnabled] = useState(
    agent?.executionStrategy?.selfCritique?.enabled ?? false,
  );
  const [critiqueTier, setCritiqueTier] = useState<ModelTierName>(
    agent?.executionStrategy?.selfCritique?.tier ?? "powerful",
  );
  const [verifyEnabled, setVerifyEnabled] = useState(
    agent?.executionStrategy?.verification?.enabled ?? false,
  );
  const [verifyCommands, setVerifyCommands] = useState(
    agent?.executionStrategy?.verification?.commands?.join("\n") ?? "",
  );
  const [verifyMaxRetries, setVerifyMaxRetries] = useState(
    agent?.executionStrategy?.verification?.maxRetries ?? 2,
  );
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(
    agent?.thinking?.mode ?? "disabled",
  );
  const [thinkingBudget, setThinkingBudget] = useState(
    agent?.thinking?.budgetTokens ?? 10000,
  );
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

      const retrievalPriming: RetrievalPrimingConfig | undefined = retrievalEnabled
        ? { enabled: true, maxChars: retrievalMaxChars }
        : undefined;

      const executionStrategy: ExecutionStrategyConfig | undefined =
        strategyType === "enhanced"
          ? {
              type: "enhanced" as const,
              selfCritique: critiqueEnabled
                ? { enabled: true, tier: critiqueTier }
                : undefined,
              verification: verifyEnabled
                ? {
                    enabled: true,
                    commands: verifyCommands
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    maxRetries: verifyMaxRetries,
                  }
                : undefined,
            }
          : undefined;

      const thinking: ThinkingConfig | undefined =
        thinkingMode !== "disabled"
          ? {
              mode: thinkingMode,
              ...(thinkingMode === "native" || thinkingMode === "auto"
                ? { budgetTokens: thinkingBudget }
                : {}),
            }
          : undefined;

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
        retrievalPriming,
        executionStrategy,
        thinking,
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

      <div className="space-y-4">
        <h4 className="text-xs font-medium text-default-500 uppercase tracking-wide">
          Retrieval Priming
        </h4>
        <p className="text-[11px] text-default-500">
          Automatically inject relevant code from indexed repositories into the system message.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={retrievalEnabled}
            onChange={(e) => setRetrievalEnabled(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-xs">Enable retrieval priming</span>
        </label>

        {retrievalEnabled && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Max Characters</label>
              <span className="text-xs text-default-500 font-mono">{retrievalMaxChars}</span>
            </div>
            <input
              type="range"
              min="2000"
              max="24000"
              step="1000"
              value={retrievalMaxChars}
              onChange={(e) => setRetrievalMaxChars(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[11px] text-default-500">
              Maximum characters of code context to inject. Higher values use more tokens.
            </p>
          </div>
        )}
      </div>

      <Divider />

      <div className="space-y-4">
        <h4 className="text-xs font-medium text-default-500 uppercase tracking-wide">
          Execution Strategy
        </h4>
        <p className="text-[11px] text-default-500">
          Add post-round quality passes to improve code output.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Strategy</label>
          <Select
            selectedKeys={[strategyType]}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as "default" | "enhanced";
              if (key) setStrategyType(key);
            }}
            size="sm"
            aria-label="Execution strategy"
          >
            <SelectItem key="default">Default</SelectItem>
            <SelectItem key="enhanced">Enhanced (critique + verification)</SelectItem>
          </Select>
        </div>

        {strategyType === "enhanced" && (
          <div className="space-y-4 pl-3 border-l-2 border-default-200">
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={critiqueEnabled}
                  onChange={(e) => setCritiqueEnabled(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-xs font-medium">Self-Critique</span>
              </label>
              {critiqueEnabled && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Critique Model Tier</label>
                  <Select
                    selectedKeys={[critiqueTier]}
                    onSelectionChange={(keys) => {
                      const key = Array.from(keys)[0] as ModelTierName;
                      if (key) setCritiqueTier(key);
                    }}
                    size="sm"
                    aria-label="Critique tier"
                  >
                    {MODEL_TIER_NAMES.map((tier) => (
                      <SelectItem key={tier} textValue={MODEL_TIER_LABELS[tier].label}>
                        <div>
                          <div className="text-xs">{MODEL_TIER_LABELS[tier].label}</div>
                          <div className="text-[11px] text-default-500">
                            {MODEL_TIER_LABELS[tier].description}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </Select>
                  <p className="text-[11px] text-default-500">
                    A separate model reviews code after each round. Use a stronger tier for better reviews.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={verifyEnabled}
                  onChange={(e) => setVerifyEnabled(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-xs font-medium">Verification Commands</span>
              </label>
              {verifyEnabled && (
                <div className="space-y-3">
                  <Textarea
                    label="Commands"
                    labelPlacement="outside"
                    value={verifyCommands}
                    onChange={(e) => setVerifyCommands(e.target.value)}
                    placeholder={"tsc --noEmit\neslint . --quiet"}
                    minRows={2}
                    classNames={{ input: "text-xs font-mono" }}
                    size="sm"
                  />
                  <p className="text-[11px] text-default-500">
                    One command per line. Run after code-producing rounds to catch errors.
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium">Max Retries</label>
                      <span className="text-xs text-default-500 font-mono">{verifyMaxRetries}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="5"
                      step="1"
                      value={verifyMaxRetries}
                      onChange={(e) => setVerifyMaxRetries(parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Divider />

      <div className="space-y-4">
        <h4 className="text-xs font-medium text-default-500 uppercase tracking-wide">
          Thinking / Chain of Thought
        </h4>
        <p className="text-[11px] text-default-500">
          Enable reasoning visibility. Native uses the model's built-in thinking API (Claude). Prompted injects CoT instructions for other models.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Mode</label>
          <Select
            selectedKeys={[thinkingMode]}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as ThinkingMode;
              if (key) setThinkingMode(key);
            }}
            size="sm"
            aria-label="Thinking mode"
          >
            <SelectItem key="disabled">Disabled</SelectItem>
            <SelectItem key="auto">Auto (detect from model)</SelectItem>
            <SelectItem key="native">Native (API extended thinking)</SelectItem>
            <SelectItem key="prompted">Prompted (tag-based CoT)</SelectItem>
          </Select>
        </div>

        {(thinkingMode === "native" || thinkingMode === "auto") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Budget Tokens</label>
              <span className="text-xs text-default-500 font-mono">{thinkingBudget.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min="1024"
              max="32000"
              step="1024"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[11px] text-default-500">
              Token budget for extended thinking. Higher values allow deeper reasoning but cost more. Min 1024.
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
