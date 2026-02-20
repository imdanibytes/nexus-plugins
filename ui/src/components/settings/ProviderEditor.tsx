import { useState } from "react";
import {
  Save, Trash2, ArrowLeft, Loader2, Wifi, WifiOff,
} from "lucide-react";
import {
  createProviderApi,
  updateProviderApi,
  deleteProviderApi,
  probeProviderDataApi,
  type ProviderPublic,
  type ProviderType,
  type ProviderCreateData,
  type EndpointStatus,
} from "@/api/client.js";
import {
  Button,
  Input,
  Divider,
  Select,
  SelectItem,
  Autocomplete,
  AutocompleteItem,
} from "@heroui/react";

const TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: "ollama", label: "Ollama" },
  { value: "anthropic", label: "Anthropic" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
];

const NAME_PLACEHOLDERS: Record<ProviderType, string> = {
  ollama: "Local Ollama",
  anthropic: "Anthropic",
  bedrock: "AWS Bedrock",
  "openai-compatible": "vLLM Server",
};

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "us-gov-east-1", "us-gov-west-1",
  "af-south-1", "ap-east-2",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ap-south-1", "ap-south-2",
  "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4",
  "ca-central-1",
  "eu-central-1", "eu-central-2", "eu-north-1",
  "eu-south-1", "eu-south-2",
  "eu-west-1", "eu-west-2", "eu-west-3",
  "il-central-1", "me-central-1", "me-south-1",
  "mx-central-1", "sa-east-1",
];

function RegionCombobox({ value, onSelect }: { value: string; onSelect: (v: string) => void }) {
  return (
    <Autocomplete
      selectedKey={value}
      onSelectionChange={(key) => { if (key) onSelect(String(key)); }}
      defaultInputValue={value}
      size="sm"
      aria-label="AWS Region"
      classNames={{ base: "w-full" }}
    >
      {AWS_REGIONS.map((r) => (
        <AutocompleteItem key={r} textValue={r}>
          <span className="font-mono text-xs">{r}</span>
        </AutocompleteItem>
      ))}
    </Autocomplete>
  );
}

interface Props {
  provider?: ProviderPublic;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function ProviderEditor({ provider, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(provider?.name || "");
  const [type, setType] = useState<ProviderType>(provider?.type || "ollama");
  const [endpoint, setEndpoint] = useState(provider?.endpoint || "");
  const [apiKey, setApiKey] = useState("");
  const [awsRegion, setAwsRegion] = useState(provider?.awsRegion || "us-east-1");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<EndpointStatus | null>(null);

  const buildData = (): ProviderCreateData => {
    const data: ProviderCreateData = { name: name.trim(), type };
    if (type === "ollama" || type === "openai-compatible") {
      data.endpoint = endpoint.trim();
    }
    if (type === "anthropic") {
      if (endpoint.trim()) data.endpoint = endpoint.trim();
      if (apiKey) data.apiKey = apiKey;
    }
    if (type === "openai-compatible" && apiKey) {
      data.apiKey = apiKey;
    }
    if (type === "bedrock") {
      data.awsRegion = awsRegion;
      if (awsAccessKeyId) data.awsAccessKeyId = awsAccessKeyId;
      if (awsSecretAccessKey) data.awsSecretAccessKey = awsSecretAccessKey;
      if (awsSessionToken) data.awsSessionToken = awsSessionToken;
    }
    return data;
  };

  const clearProbe = () => setProbeResult(null);

  const handleProbe = async () => {
    setProbing(true);
    try {
      const data = buildData();
      if (provider) (data as any).id = provider.id;
      const result = await probeProviderDataApi(data);
      setProbeResult(result);
    } catch {
      setProbeResult({ reachable: false, provider: "unknown", error: "Request failed", models: [] });
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !probeResult?.reachable) return;
    setSaving(true);
    try {
      if (provider) {
        await updateProviderApi(provider.id, buildData());
      } else {
        await createProviderApi(buildData());
      }
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!provider) return;
    await deleteProviderApi(provider.id);
    onDelete?.();
  };

  const canSave = name.trim() && probeResult?.reachable && !saving;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="light" isIconOnly size="sm" onPress={onCancel} className="h-7 w-7 min-w-7">
          <ArrowLeft size={14} />
        </Button>
        <div>
          <h3 className="text-sm font-medium">
            {provider ? "Edit Provider" : "New Provider"}
          </h3>
          <p className="text-[11px] text-default-500">
            {provider ? "Update connection settings." : "Connect to an LLM service."}
          </p>
        </div>
      </div>

      <Divider />

      <Input
        label="Name"
        labelPlacement="outside"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={NAME_PLACEHOLDERS[type]}
        isRequired
        size="sm"
      />

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Type</label>
        <Select
          selectedKeys={[type]}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0] as ProviderType;
            if (key) { setType(key); clearProbe(); }
          }}
          size="sm"
          aria-label="Provider type"
        >
          {TYPE_OPTIONS.map((o) => (
            <SelectItem key={o.value}>{o.label}</SelectItem>
          ))}
        </Select>
      </div>

      {(type === "ollama" || type === "openai-compatible") && (
        <Input
          label="Endpoint"
          labelPlacement="outside"
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); clearProbe(); }}
          placeholder={type === "ollama" ? "http://host.docker.internal:11434" : "http://localhost:8080"}
          classNames={{ input: "font-mono text-xs" }}
          isRequired
          size="sm"
        />
      )}

      {type === "anthropic" && (
        <>
          <Input
            label="API Key"
            labelPlacement="outside"
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); clearProbe(); }}
            placeholder={provider ? "••••••••• (unchanged)" : "sk-ant-..."}
            size="sm"
          />
          <Input
            label="Endpoint Override"
            description="Optional"
            labelPlacement="outside"
            value={endpoint}
            onChange={(e) => { setEndpoint(e.target.value); clearProbe(); }}
            placeholder="https://api.anthropic.com"
            classNames={{ input: "font-mono text-xs" }}
            size="sm"
          />
        </>
      )}

      {type === "openai-compatible" && (
        <Input
          label="API Key"
          description="Optional"
          labelPlacement="outside"
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); clearProbe(); }}
          placeholder={provider ? "••••••••• (unchanged)" : "sk-..."}
          size="sm"
        />
      )}

      {type === "bedrock" && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">AWS Region</label>
            <RegionCombobox
              value={awsRegion}
              onSelect={(v) => { setAwsRegion(v); clearProbe(); }}
            />
          </div>
          <Input
            label="Access Key ID"
            labelPlacement="outside"
            type="password"
            value={awsAccessKeyId}
            onChange={(e) => { setAwsAccessKeyId(e.target.value); clearProbe(); }}
            placeholder={provider ? "••••••••• (unchanged)" : "AKIA..."}
            size="sm"
          />
          <Input
            label="Secret Access Key"
            labelPlacement="outside"
            type="password"
            value={awsSecretAccessKey}
            onChange={(e) => { setAwsSecretAccessKey(e.target.value); clearProbe(); }}
            placeholder={provider ? "••••••••• (unchanged)" : ""}
            size="sm"
          />
          <Input
            label="Session Token"
            description="Optional, for temporary credentials"
            labelPlacement="outside"
            type="password"
            value={awsSessionToken}
            onChange={(e) => { setAwsSessionToken(e.target.value); clearProbe(); }}
            placeholder={provider ? "••••••••• (unchanged)" : ""}
            size="sm"
          />
        </>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          variant="bordered"
          size="sm"
          onPress={handleProbe}
          isDisabled={probing}
          className="gap-1.5"
        >
          {probing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : probeResult?.reachable ? (
            <Wifi size={13} className="text-green-400" />
          ) : probeResult && !probeResult.reachable ? (
            <WifiOff size={13} className="text-danger" />
          ) : (
            <Wifi size={13} />
          )}
          Test Connection
        </Button>
        {probeResult && (
          <p className="text-xs">
            {probeResult.reachable ? (
              <span className="text-green-400">
                Connected — {probeResult.models.length} model
                {probeResult.models.length !== 1 ? "s" : ""} found
              </span>
            ) : (
              <span className="text-danger">
                {probeResult.error || "Unreachable"}
              </span>
            )}
          </p>
        )}
      </div>

      <Divider />

      <div className="flex items-center gap-2">
        <Button type="submit" color="primary" size="sm" isDisabled={!canSave} className="gap-1.5">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </Button>
        <Button type="button" variant="light" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        {provider && onDelete && (
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
