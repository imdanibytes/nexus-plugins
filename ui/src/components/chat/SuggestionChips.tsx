import type { FC } from "react";
import { useThreadStore, EMPTY_CONV } from "@/stores/threadStore.js";
import { useThreadListStore } from "@/stores/threadListStore.js";

interface Props {
  onSelect: (text: string) => void;
  isStreaming: boolean;
}

export const SuggestionChips: FC<Props> = ({ onSelect, isStreaming }) => {
  const activeThreadId = useThreadListStore((s) => s.activeThreadId);
  const suggestions = useThreadStore(
    (s) => (s.conversations[activeThreadId ?? ""] ?? EMPTY_CONV).suggestions,
  );

  if (isStreaming || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pb-2 fade-in animate-in duration-200">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          onClick={() => onSelect(text)}
        >
          {text}
        </button>
      ))}
    </div>
  );
};
