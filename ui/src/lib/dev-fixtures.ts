/**
 * Dev-only fixtures — populates stores with dummy data for visual testing.
 * Import and call `injectDevFixtures()` from App.tsx in dev mode.
 */
import { useThreadListStore } from "@/stores/threadListStore.js";
import { useThreadStore } from "@/stores/threadStore.js";
import { useTaskStore } from "@/stores/taskStore.js";
import { useChatStore } from "@/stores/chatStore.js";
import type { ChatMessage } from "@/stores/threadStore.js";
import type { Plan, Task, TaskState } from "@/api/client.js";
import type { TimingSpan } from "@/stores/chatStore.js";

const THREAD_ID = "dev-thread-001";

const now = Date.now();

// ── Timing spans (for debug waterfall on msg-004) ──

const timingSpans: TimingSpan[] = [
  { id: "t-turn", name: "turn", parentId: null, startMs: 0, endMs: 4820, durationMs: 4820 },
  { id: "t-setup", name: "setup", parentId: "t-turn", startMs: 0, endMs: 185, durationMs: 185 },
  { id: "t-settings", name: "fetch_settings", parentId: "t-setup", startMs: 2, endMs: 38, durationMs: 36, metadata: { cached: false } },
  { id: "t-executor", name: "build_tool_executor", parentId: "t-setup", startMs: 40, endMs: 185, durationMs: 145 },
  { id: "t-mcp", name: "fetch_mcp_tools", parentId: "t-executor", startMs: 42, endMs: 180, durationMs: 138, metadata: { servers: 3, tools: 47 } },
  { id: "t-sys", name: "system_message", parentId: "t-turn", startMs: 186, endMs: 210, durationMs: 24 },
  { id: "t-r1", name: "round:1", parentId: "t-turn", startMs: 210, endMs: 2650, durationMs: 2440 },
  { id: "t-r1-provider", name: "provider:anthropic", parentId: "t-r1", startMs: 212, endMs: 1480, durationMs: 1268, metadata: { model: "claude-sonnet-4-20250514", inputTokens: 3842, outputTokens: 487, cacheRead: 1204, cacheWrite: 2638, stopReason: "tool_use", requestId: "req_01ABC123def456" }, markers: [{ label: "TTFB", timeMs: 680 }, { label: "first tool call", timeMs: 920 }, { label: "second tool call", timeMs: 1100 }, { label: "third tool call", timeMs: 1350 }, { label: "stop", timeMs: 1470 }] },
  { id: "t-r1-llm", name: "llm_call", parentId: "t-r1-provider", startMs: 215, endMs: 1475, durationMs: 1260 },
  { id: "t-r1-tools", name: "tool_execution", parentId: "t-r1", startMs: 1485, endMs: 2640, durationMs: 1155 },
  { id: "t-r1-t1", name: "tool:write_file", parentId: "t-r1-tools", startMs: 1490, endMs: 1620, durationMs: 130, metadata: { path: "/src/auth/AuthManager.ts" } },
  { id: "t-r1-t2", name: "tool:edit_file", parentId: "t-r1-tools", startMs: 1625, endMs: 1780, durationMs: 155, metadata: { path: "/src/middleware/auth.ts" } },
  { id: "t-r1-t3", name: "tool:execute_command", parentId: "t-r1-tools", startMs: 1785, endMs: 2635, durationMs: 850, metadata: { command: "npm test -- --grep auth" } },
  { id: "t-r2", name: "round:2", parentId: "t-turn", startMs: 2655, endMs: 4815, durationMs: 2160 },
  { id: "t-r2-provider", name: "provider:anthropic", parentId: "t-r2", startMs: 2660, endMs: 4810, durationMs: 2150, metadata: { model: "claude-sonnet-4-20250514", inputTokens: 5120, outputTokens: 312 }, markers: [{ label: "TTFB", timeMs: 3180 }] },
  { id: "t-r2-llm", name: "llm_call", parentId: "t-r2-provider", startMs: 2665, endMs: 4805, durationMs: 2140 },
];

// ── Thread list (sidebar) ──

const threads = [
  { id: THREAD_ID, title: "Glass redesign review", createdAt: now - 3600_000, updatedAt: now - 60_000, messageCount: 6 },
  { id: "dev-thread-002", title: "Fix auth token refresh", createdAt: now - 86_400_000, updatedAt: now - 7200_000, messageCount: 12 },
  { id: "dev-thread-003", title: "Add dark mode support", createdAt: now - 86_400_000 * 2, updatedAt: now - 86_400_000, messageCount: 4 },
  { id: "dev-thread-004", title: "Database migration plan", createdAt: now - 86_400_000 * 5, updatedAt: now - 86_400_000 * 3, messageCount: 8 },
  { id: "dev-thread-005", title: "API rate limiting", createdAt: now - 86_400_000 * 8, updatedAt: now - 86_400_000 * 7, messageCount: 3 },
];

// ── Messages ──

const messages: ChatMessage[] = [
  {
    id: "msg-001",
    role: "user",
    parts: [{ type: "text", text: "Can you help me refactor the authentication module? The current token refresh logic is scattered across three files and it's getting hard to maintain." }],
    createdAt: new Date(now - 300_000),
  },
  {
    id: "msg-002",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "tc-001",
        toolName: "search_files",
        args: { pattern: "**/*auth*", path: "/src" },
        argsText: JSON.stringify({ pattern: "**/*auth*", path: "/src" }),
        result: JSON.stringify({
          matches: [
            { path: "src/auth/token.ts", size: 2847, modified: "2025-12-14T08:22:31Z" },
            { path: "src/auth/refresh.ts", size: 1923, modified: "2025-12-10T14:05:12Z" },
            { path: "src/auth/types.ts", size: 812, modified: "2025-11-28T09:41:00Z" },
            { path: "src/auth/constants.ts", size: 345, modified: "2025-11-15T11:30:00Z" },
            { path: "src/auth/__tests__/token.test.ts", size: 4201, modified: "2025-12-14T08:30:00Z" },
            { path: "src/auth/__tests__/refresh.test.ts", size: 3156, modified: "2025-12-10T14:20:00Z" },
            { path: "src/middleware/auth.ts", size: 1567, modified: "2025-12-12T16:44:22Z" },
            { path: "src/middleware/auth-rate-limit.ts", size: 982, modified: "2025-11-20T10:15:00Z" },
            { path: "src/hooks/useAuth.ts", size: 1243, modified: "2025-12-01T13:22:00Z" },
            { path: "src/hooks/useAuthRedirect.ts", size: 678, modified: "2025-11-25T09:00:00Z" },
            { path: "src/utils/auth-helpers.ts", size: 1456, modified: "2025-12-05T17:33:00Z" },
            { path: "src/config/auth.config.ts", size: 534, modified: "2025-11-10T08:00:00Z" },
          ],
          total: 12,
        }, null, 2),
        status: { type: "complete" },
      },
      {
        type: "tool-call",
        toolCallId: "tc-002",
        toolName: "read_file",
        args: { path: "/src/auth/token.ts" },
        argsText: JSON.stringify({ path: "/src/auth/token.ts" }),
        result: `import { jwtDecode } from "jwt-decode";
import { AuthConfig } from "../config/auth.config";
import { TokenPair, DecodedToken } from "./types";
import { TOKEN_STORAGE_KEY, REFRESH_STORAGE_KEY } from "./constants";

const TOKEN_EXPIRY_BUFFER_MS = 30_000; // 30s before actual expiry

export class TokenStore {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private decoded: DecodedToken | null = null;

  constructor(private config: AuthConfig) {
    this.hydrate();
  }

  private hydrate(): void {
    try {
      this.accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      this.refreshToken = localStorage.getItem(REFRESH_STORAGE_KEY);
      if (this.accessToken) {
        this.decoded = jwtDecode<DecodedToken>(this.accessToken);
      }
    } catch {
      this.clear();
    }
  }

  get isValid(): boolean {
    if (!this.decoded || !this.accessToken) return false;
    const expiresAt = this.decoded.exp * 1000;
    return Date.now() < expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  get current(): string | null {
    return this.isValid ? this.accessToken : null;
  }

  get refresh(): string | null {
    return this.refreshToken;
  }

  set(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.decoded = jwtDecode<DecodedToken>(tokens.accessToken);
    localStorage.setItem(TOKEN_STORAGE_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
  }

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.decoded = null;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_STORAGE_KEY);
  }
}`,
        status: { type: "complete" },
      },
      {
        type: "text",
        text: "I found the auth-related files. The token refresh logic is indeed fragmented:\n\n- **`src/auth/token.ts`** — stores and retrieves tokens\n- **`src/auth/refresh.ts`** — handles the refresh flow\n- **`src/middleware/auth.ts`** — intercepts expired tokens\n\nHere's what I'd do: consolidate into a single `AuthManager` class that owns the full lifecycle — storage, refresh, and retry logic. The middleware just calls `authManager.getValidToken()` and doesn't need to know about refresh internals.\n\n```typescript\nclass AuthManager {\n  private accessToken: string | null = null;\n  private refreshToken: string | null = null;\n  private refreshPromise: Promise<string> | null = null;\n\n  async getValidToken(): Promise<string> {\n    if (this.isTokenValid(this.accessToken)) {\n      return this.accessToken!;\n    }\n    return this.refresh();\n  }\n\n  private async refresh(): Promise<string> {\n    // Deduplicate concurrent refresh calls\n    if (!this.refreshPromise) {\n      this.refreshPromise = this.doRefresh();\n    }\n    return this.refreshPromise;\n  }\n}\n```\n\nThe key insight is the **deduplication** — if three requests hit an expired token simultaneously, only one refresh call fires.",
      },
    ],
    createdAt: new Date(now - 280_000),
    status: { type: "complete" },
    metadata: { profileName: "Claude" },
  },
  {
    id: "msg-003",
    role: "user",
    parts: [{ type: "text", text: "That looks great. Can you implement it? Also add proper error handling for when the refresh token itself expires." }],
    createdAt: new Date(now - 200_000),
  },
  {
    id: "msg-004",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "tc-003",
        toolName: "write_file",
        args: { path: "/src/auth/AuthManager.ts" },
        argsText: JSON.stringify({ path: "/src/auth/AuthManager.ts" }),
        result: { success: true },
        status: { type: "complete" },
      },
      {
        type: "tool-call",
        toolCallId: "tc-004",
        toolName: "edit_file",
        args: {
          path: "/src/middleware/auth.ts",
          old_string: "import { refreshToken } from \"../auth/refresh\";\nimport { getStoredToken, setTokens } from \"../auth/token\";\nimport { AuthError } from \"../auth/types\";",
          new_string: "import { authManager } from \"../auth/AuthManager\";",
        },
        argsText: JSON.stringify({
          path: "/src/middleware/auth.ts",
          old_string: "import { refreshToken } from \"../auth/refresh\";\nimport { getStoredToken, setTokens } from \"../auth/token\";\nimport { AuthError } from \"../auth/types\";",
          new_string: "import { authManager } from \"../auth/AuthManager\";",
        }, null, 2),
        result: "Successfully edited /src/middleware/auth.ts\n\n**Changes applied:**\n- Replaced 3-line import block with single AuthManager import\n- Removed unused `AuthError` type import\n\nThe middleware now delegates all token management to `authManager.getValidToken()` instead of manually coordinating between `refreshToken()`, `getStoredToken()`, and `setTokens()`.",
        status: { type: "complete" },
      },
      {
        type: "tool-call",
        toolCallId: "tc-005",
        toolName: "execute_command",
        args: { command: "npm", args: ["test", "--", "--grep", "auth"] },
        argsText: JSON.stringify({ command: "npm", args: ["test", "--", "--grep", "auth"] }),
        result: { stdout: "PASS src/auth/__tests__/AuthManager.test.ts\n  6 passed, 0 failed", exitCode: 0 },
        status: { type: "complete" },
      },
      {
        type: "text",
        text: "Done. Created `AuthManager` with:\n\n1. **Concurrent refresh deduplication** — multiple expired-token requests share one refresh call\n2. **Refresh token expiry handling** — catches 401 on refresh and fires `onSessionExpired` callback\n3. **Automatic retry** — failed requests due to expired tokens get retried once after refresh\n\nAll 6 auth tests pass. The middleware is now a thin wrapper that calls `authManager.getValidToken()`.",
      },
    ],
    createdAt: new Date(now - 180_000),
    status: { type: "complete" },
    metadata: { profileName: "Claude", timingSpans },
  },
  {
    id: "msg-005",
    role: "user",
    parts: [{ type: "text", text: "Perfect. Now let's add rate limiting to the API endpoints." }],
    createdAt: new Date(now - 60_000),
  },
  {
    id: "msg-006",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "tc-006",
        toolName: "search_content",
        args: { pattern: "rateLimit|throttle", path: "/src", include: "*.ts" },
        argsText: JSON.stringify({ pattern: "rateLimit|throttle", path: "/src", include: "*.ts" }),
        status: { type: "running" },
      },
    ],
    createdAt: new Date(now - 50_000),
    status: { type: "streaming" },
    metadata: { profileName: "Claude" },
  },
  {
    id: "msg-007",
    role: "user",
    parts: [{ type: "text", text: "Also check if there's any existing middleware we can extend." }],
    createdAt: new Date(now - 30_000),
  },
  {
    id: "msg-008",
    role: "assistant",
    parts: [],
    createdAt: new Date(now - 25_000),
    status: { type: "streaming" },
    metadata: { profileName: "Claude" },
  },
];

// ── Tasks ──

const taskRecords: Record<string, Task> = {
  "task-1": {
    id: "task-1",
    title: "Audit existing auth module",
    status: "completed",
    dependsOn: [],
    createdAt: now - 300_000,
    updatedAt: now - 280_000,
    completedAt: now - 280_000,
  },
  "task-2": {
    id: "task-2",
    title: "Create AuthManager class",
    status: "completed",
    dependsOn: ["task-1"],
    createdAt: now - 280_000,
    updatedAt: now - 200_000,
    completedAt: now - 200_000,
  },
  "task-3": {
    id: "task-3",
    title: "Migrate middleware to use AuthManager",
    status: "completed",
    dependsOn: ["task-2"],
    createdAt: now - 200_000,
    updatedAt: now - 180_000,
    completedAt: now - 180_000,
  },
  "task-4": {
    id: "task-4",
    title: "Add rate limiting middleware",
    status: "in_progress",
    activeLabel: "Searching for existing rate limit patterns…",
    dependsOn: ["task-3"],
    createdAt: now - 60_000,
    updatedAt: now - 50_000,
  },
  "task-5": {
    id: "task-5",
    title: "Configure per-endpoint rate limits",
    status: "pending",
    dependsOn: ["task-4"],
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
  },
  "task-6": {
    id: "task-6",
    title: "Add rate limit response headers",
    status: "pending",
    dependsOn: ["task-4"],
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
  },
  "task-7": {
    id: "task-7",
    title: "Write rate limiting tests",
    status: "pending",
    dependsOn: ["task-5", "task-6"],
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
  },
};

const plan: Plan = {
  id: "plan-001",
  conversationId: THREAD_ID,
  title: "Auth refactor + rate limiting",
  summary: "Consolidate auth token management into AuthManager, then add sliding-window rate limiting per endpoint.",
  taskIds: ["task-1", "task-2", "task-3", "task-4", "task-5", "task-6", "task-7"],
  approved: true,
  createdAt: now - 300_000,
  updatedAt: now - 50_000,
};

const taskState: TaskState = {
  plan,
  tasks: taskRecords,
  mode: "execution",
};

// ── Inject ──

export function injectDevFixtures() {
  // Theme — NexusProvider isn't running in fixture mode, so set it from system pref
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", prefersDark);
  document.documentElement.classList.toggle("light", !prefersDark);

  // Thread list
  useThreadListStore.setState({
    threads,
    activeThreadId: THREAD_ID,
  });

  // Conversation messages
  useThreadStore.setState({
    conversations: {
      [THREAD_ID]: {
        messages,
        isStreaming: true,
        isLoadingHistory: false,
        repository: [],
        childrenMap: {},
        branchSelections: {},
        suggestions: [],
      },
    },
  });

  // Task state
  useTaskStore.setState({
    states: { [THREAD_ID]: taskState },
    panelOpen: true,
  });

  // Agents (so AgentSwitcher shows)
  useChatStore.setState({
    agents: [
      { id: "agent-1", name: "Claude", model: "claude-sonnet-4-20250514", providerId: "prov-1", systemPrompt: "", temperature: 0.7, createdAt: now, updatedAt: now },
      { id: "agent-2", name: "GPT-4o", model: "gpt-4o", providerId: "prov-2", systemPrompt: "", temperature: 0.5, createdAt: now, updatedAt: now },
    ],
    activeAgentId: "agent-1",
    providers: [
      { id: "prov-1", name: "Anthropic", type: "anthropic", createdAt: now, updatedAt: now },
      { id: "prov-2", name: "OpenAI", type: "openai-compatible", endpoint: "https://api.openai.com/v1", createdAt: now, updatedAt: now },
    ],
  });
}
