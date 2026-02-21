import { type FC } from "react";
import { PlusIcon, MoreHorizontalIcon, TrashIcon } from "lucide-react";
import { useThreadListStore } from "@/stores/threadListStore.js";
import { useThreadStore } from "@/stores/threadStore.js";
import { useChatStore } from "@/stores/chatStore.js";
import {
  Button,
  Skeleton,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@heroui/react";
import { cn } from "@imdanibytes/nexus-ui";

export const ThreadList: FC = () => {
  const threads = useThreadListStore((s) => s.threads);
  const activeThreadId = useThreadListStore((s) => s.activeThreadId);
  const isLoading = useThreadListStore((s) => s.isLoading);
  const { createThread, switchThread, deleteThread } =
    useThreadListStore.getState();

  const handleNew = async () => {
    useChatStore.getState().setSettingsOpen(false);
    await createThread();
  };

  const handleSwitch = (id: string) => {
    useChatStore.getState().setSettingsOpen(false);
    switchThread(id);
  };

  return (
    <div className="aui-thread-list-root flex flex-col gap-1">
      <Button
        variant="bordered"
        className="aui-thread-list-new h-9 justify-start gap-2 rounded-lg px-3 text-sm hover:bg-default-100"
        onPress={handleNew}
      >
        <PlusIcon className="size-4" />
        New Thread
      </Button>

      {isLoading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="flex h-9 items-center px-3"
              role="status"
              aria-label="Loading threads"
            >
              <Skeleton className="h-4 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        threads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          return (
            <div
              key={thread.id}
              className={cn(
                "aui-thread-list-item group flex h-9 items-center gap-2 rounded-lg transition-colors hover:bg-default-100 focus-visible:bg-default-100 focus-visible:outline-none",
                isActive && "bg-default-100",
              )}
            >
              <button
                className="flex h-full min-w-0 flex-1 items-center gap-2 truncate px-3 text-start text-sm"
                onClick={() => handleSwitch(thread.id)}
              >
                <StreamingDot threadId={thread.id} />
                {thread.title || "New Chat"}
              </button>
              <ThreadItemMenu
                threadId={thread.id}
                onDelete={() => deleteThread(thread.id)}
              />
            </div>
          );
        })
      )}
    </div>
  );
};

/** Pulsing dot that only renders when the given thread is actively streaming. */
const StreamingDot: FC<{ threadId: string }> = ({ threadId }) => {
  const isStreaming = useThreadStore(
    (s) => s.conversations[threadId]?.isStreaming ?? false,
  );
  if (!isStreaming) return null;
  return (
    <span className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
};

const ThreadItemMenu: FC<{
  threadId: string;
  onDelete: () => void;
}> = ({ onDelete }) => {
  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          variant="light"
          isIconOnly
          size="sm"
          className="mr-2 size-7 min-w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:bg-default-200 data-[open=true]:opacity-100 group-[.bg-default-100]:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
          <span className="sr-only">More options</span>
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Thread actions">
        <DropdownItem
          key="delete"
          className="text-danger"
          color="danger"
          startContent={<TrashIcon className="size-4" />}
          onPress={onDelete}
        >
          Delete
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
};
