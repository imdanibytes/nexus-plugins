import type { FC } from "react";
import { ContextRing } from "@imdanibytes/nexus-ui";
import { useThreadListStore } from "@/stores/threadListStore.js";
import { useUsageStore } from "@/stores/usageStore.js";

export const ContextRingConnected: FC = () => {
  const activeThreadId = useThreadListStore((s) => s.activeThreadId);
  const usage = useUsageStore((s) =>
    activeThreadId ? s.usage[activeThreadId] : undefined,
  );

  if (!usage || !usage.contextWindow) return null;

  return (
    <ContextRing
      contextTokens={usage.contextTokens}
      contextWindow={usage.contextWindow}
      totalCost={usage.totalCost}
    />
  );
};
