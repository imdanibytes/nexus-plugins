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
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@imdanibytes/nexus-ui";

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
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> Loading tiers…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Model Tiers</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Assign agents to tiers for task delegation. Complex tasks use the powerful tier, routine work uses fast.
        </p>
      </div>

      {MODEL_TIER_NAMES.map((name) => {
        const agentId = tiers[name];
        const Icon = TIER_ICONS[name];
        const label = MODEL_TIER_LABELS[name];
        const assigned = agents.find((a) => a.id === agentId);

        return (
          <div
            key={name}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <Icon size={14} className="text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <Label className="text-xs font-medium">{label.label}</Label>
              <p className="text-[10px] text-muted-foreground">{label.description}</p>
            </div>
            <Select
              value={agentId || NONE}
              onValueChange={(v) => setTierAgent(name, v)}
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue>
                  {assigned ? assigned.name : "None"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
