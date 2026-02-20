import { memo, useCallback, useRef, useState, type FC } from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "@imdanibytes/nexus-ui";
import { useScrollLock } from "@/hooks/useScrollLock.js";
import { formatToolDescription } from "@/lib/tool-descriptions.js";
import type { ToolCallStatus } from "@/stores/threadStore.js";

const ANIMATION_DURATION = 200;

// ── Root ──

export type ToolFallbackRootProps = React.ComponentProps<"div"> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    if (!next) {
      lockScroll();
    }
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    controlledOnOpenChange?.(next);
  }, [isOpen, lockScroll, isControlled, controlledOnOpenChange]);

  return (
    <ToolFallbackContext.Provider value={{ isOpen, toggle: handleToggle }}>
      <div
        ref={collapsibleRef}
        data-slot="tool-fallback-root"
        data-state={isOpen ? "open" : "closed"}
        className={cn(
          "aui-tool-fallback-root group/tool-fallback-root w-full rounded-lg border border-default-200 dark:border-default-200/50 bg-default-100/80 dark:bg-default-50/30 backdrop-blur-sm py-3",
          className,
        )}
        style={
          {
            "--animation-duration": `${ANIMATION_DURATION}ms`,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </ToolFallbackContext.Provider>
  );
}

// Context for open state
import { createContext, useContext } from "react";
const ToolFallbackContext = createContext<{ isOpen: boolean; toggle: () => void }>({
  isOpen: false,
  toggle: () => {},
});

// ── Trigger ──

type ToolStatusType = NonNullable<ToolCallStatus>["type"];

const statusIconMap: Record<ToolStatusType, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
};

function ToolFallbackTrigger({
  toolName,
  argsText,
  status,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  toolName: string;
  argsText?: string;
  status?: ToolCallStatus;
}) {
  const { isOpen, toggle } = useContext(ToolFallbackContext);
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";

  const Icon = statusIconMap[statusType];

  // Human-readable description
  const description = formatToolDescription(toolName, argsText);

  return (
    <button
      type="button"
      data-slot="tool-fallback-trigger"
      data-state={isOpen ? "open" : "closed"}
      className={cn(
        "aui-tool-fallback-trigger group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors",
        className,
      )}
      onClick={toggle}
      {...props}
    >
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn(
          "aui-tool-fallback-trigger-icon size-4 shrink-0",
          isCancelled && "text-default-400",
          isRunning && "animate-spin",
        )}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          "aui-tool-fallback-trigger-label-wrapper relative inline-block grow text-left leading-none",
          isCancelled && "text-default-400 line-through",
        )}
      >
        <span>{description}</span>
        {isRunning && (
          <span
            aria-hidden
            data-slot="tool-fallback-trigger-shimmer"
            className="aui-tool-fallback-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {description}
          </span>
        )}
      </span>
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className={cn(
          "aui-tool-fallback-trigger-chevron size-4 shrink-0 text-default-400",
          "transition-transform duration-200 ease-out",
          isOpen ? "rotate-0" : "-rotate-90",
        )}
      />
    </button>
  );
}

// ── Content ──

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { isOpen } = useContext(ToolFallbackContext);

  if (!isOpen) return null;

  return (
    <div
      data-slot="tool-fallback-content"
      data-state={isOpen ? "open" : "closed"}
      className={cn(
        "aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
        className,
      )}
      {...props}
    >
      <div className="mt-3 flex flex-col gap-2 border-t border-default-200/50 pt-2">{children}</div>
    </div>
  );
}

// ── Args / Result / Error ──

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<"div"> & { argsText?: string }) {
  if (!argsText) return null;
  return (
    <div
      data-slot="tool-fallback-args"
      className={cn("aui-tool-fallback-args px-4", className)}
      {...props}
    >
      <pre className="aui-tool-fallback-args-value whitespace-pre-wrap text-default-500">
        {argsText}
      </pre>
    </div>
  );
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<"div"> & { result?: unknown }) {
  if (result === undefined) return null;
  return (
    <div
      data-slot="tool-fallback-result"
      className={cn(
        "aui-tool-fallback-result border-t border-dashed border-default-200/50 px-4 pt-2",
        className,
      )}
      {...props}
    >
      <p className="aui-tool-fallback-result-header font-semibold text-default-800">Result:</p>
      <pre className="aui-tool-fallback-result-content whitespace-pre-wrap text-default-500">
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<"div"> & { status?: ToolCallStatus }) {
  if (status?.type !== "incomplete") return null;
  const error = status.error;
  const errorText = error
    ? typeof error === "string"
      ? error
      : JSON.stringify(error)
    : null;
  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn("aui-tool-fallback-error px-4", className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header font-semibold text-default-500">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-default-500">
        {errorText}
      </p>
    </div>
  );
}

// ── Composed ToolFallback ──

interface ToolFallbackProps {
  toolName: string;
  argsText?: string;
  result?: unknown;
  status?: ToolCallStatus;
}

const ToolFallbackImpl: FC<ToolFallbackProps> = ({
  toolName,
  argsText,
  result,
  status,
}) => {
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";

  return (
    <ToolFallbackRoot
      className={cn(isCancelled && "border-default-200/20 bg-default-50/20")}
    >
      <ToolFallbackTrigger toolName={toolName} argsText={argsText} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          argsText={argsText}
          className={cn(isCancelled && "opacity-60")}
        />
        {!isCancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

export const ToolFallback = memo(ToolFallbackImpl);
