import { useState, useEffect, useCallback } from "react";
import { Zap, Scale, Brain, Loader2 } from "lucide-react";
import {
  fetchModelTiers,
  updateModelTiers,
  type Agent,
  type ModelTiers,
  type ModelTierName,
  MODEL_TIER_NAMES,
  MODEL_TIER_LABELS,
} from "@/api/client.js";
import { Select, SelectItem } from "@heroui/react";

interface Props {
  agents: Agent[];
}

const TIER_ICONS: Record<ModelTierName, typeof Zap> = {
  fast: Zap,
  balanced: Scale,
  powerful: Brain,
};

const NONE = "__none__";

export function ModelTiersSection({ agents }: Props) {
  const [tiers, setTiers] = useState<ModelTiers>({ fast: null, balanced: null, powerful: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchModelTiers().then((t) => { setTiers(t); setLoading(false); });
  }, []);

  const save = useCallback(async (next: ModelTiers) => {
    setTiers(next);
    await updateModelTiers(next);
  }, []);

  const setTierAgent = (tier: ModelTierName, agentId: string) => {
    save({ ...tiers, [tier]: agentId === NONE ? null : agentId });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-default-500">
        <Loader2 size={13} className="animate-spin" /> Loading tiers…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Model Tiers</h3>
        <p className="text-[11px] text-default-500 mt-0.5">
          Assign agents to tiers for task delegation. Complex tasks use the powerful tier, routine work uses fast.
        </p>
      </div>

      {MODEL_TIER_NAMES.map((name) => {
        const agentId = tiers[name];
        const Icon = TIER_ICONS[name];
        const label = MODEL_TIER_LABELS[name];

        return (
          <div
            key={name}
            className="flex items-center gap-3 rounded-lg border border-default-200 dark:border-default-200/50 px-3 py-2.5"
          >
            <Icon size={14} className="text-default-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium">{label.label}</span>
              <p className="text-[10px] text-default-500">{label.description}</p>
            </div>
            <Select
              size="sm"
              aria-label={`${label.label} tier agent`}
              selectedKeys={agentId ? [agentId] : [NONE]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setTierAgent(name, selected);
              }}
              className="w-44"
              classNames={{
                trigger: "h-8 min-h-8 text-xs",
              }}
              items={[{ id: NONE, name: "None" }, ...agents.map((a) => ({ id: a.id, name: a.name }))]}
            >
              {(item) => <SelectItem key={item.id}>{item.name}</SelectItem>}
            </Select>
          </div>
        );
      })}
    </div>
  );
}
