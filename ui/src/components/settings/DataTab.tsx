import { useState, useEffect } from "react";
import { Check, Download, Trash2, Loader2 } from "lucide-react";
import {
  fetchConversations,
  deleteAllConversations,
  exportConversations,
} from "@/api/client.js";
import { useThreadListStore } from "@/stores/threadListStore.js";
import {
  Button,
  Divider,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";

export function DataTab() {
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadThreads = useThreadListStore((s) => s.loadThreads);
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  useEffect(() => {
    fetchConversations().then((c) => setCount(c.length));
  }, []);

  async function handleExport() {
    setExporting(true);
    setExportedPath(null);
    setExportError(null);
    try {
      const { path } = await exportConversations();
      setExportedPath(path);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAll(onClose: () => void) {
    setDeleting(true);
    try {
      await deleteAllConversations();
      setCount(0);
      await loadThreads();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const hasConversations = count !== null && count > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Download size={14} strokeWidth={1.5} className="text-default-500" />
          <h3 className="text-sm font-medium">Export conversations</h3>
        </div>
        <p className="text-xs text-default-500">
          Save all conversations as a JSON file to your Downloads folder.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="bordered"
            size="sm"
            onPress={handleExport}
            isDisabled={exporting || !hasConversations}
          >
            {exporting && <Loader2 size={14} className="animate-spin mr-1.5" />}
            Export{count !== null ? ` (${count})` : ""}
          </Button>
          {exportedPath && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check size={12} />
              Saved to {exportedPath}
            </span>
          )}
          {exportError && (
            <span className="text-xs text-danger">{exportError}</span>
          )}
        </div>
      </div>

      <Divider />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Trash2 size={14} strokeWidth={1.5} className="text-default-500" />
          <h3 className="text-sm font-medium">Delete all conversations</h3>
        </div>
        <p className="text-xs text-default-500">
          Permanently remove all conversations. This cannot be undone.
        </p>
        <Button
          color="danger"
          size="sm"
          isDisabled={!hasConversations || deleting}
          onPress={onOpen}
        >
          {deleting && <Loader2 size={14} className="animate-spin mr-1.5" />}
          Delete all{count !== null ? ` (${count})` : ""}
        </Button>

        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Delete all conversations?</ModalHeader>
                <ModalBody>
                  <p className="text-sm text-default-500">
                    This will permanently delete {count} conversation{count !== 1 ? "s" : ""}.
                    This action cannot be undone.
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="light" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button color="danger" onPress={() => handleDeleteAll(onClose)}>
                    Delete all
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
