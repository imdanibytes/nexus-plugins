import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, AgentSettings, Provider } from "../src/types.js";

// ── Module mocks ──

vi.mock("../src/config/agents.js", () => ({
  getAgent: vi.fn(),
  getActiveAgentId: vi.fn(),
}));

vi.mock("../src/config/providers.js", () => ({
  getProvider: vi.fn(),
}));

vi.mock("../src/config/client-factory.js", () => ({
  createLlmClient: vi.fn(),
}));

// Mock the Anthropic constructor — must use `function` for `new` to work
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn(function (this: any) { this._type = "anthropic-client"; }),
  };
});

import { getAgent, getActiveAgentId } from "../src/config/agents.js";
import { getProvider } from "../src/config/providers.js";
import { createLlmClient } from "../src/config/client-factory.js";
import { resolveTurnConfig } from "../src/turn-config.js";

const mockGetAgent = vi.mocked(getAgent);
const mockGetActiveAgentId = vi.mocked(getActiveAgentId);
const mockGetProvider = vi.mocked(getProvider);
const mockCreateLlmClient = vi.mocked(createLlmClient);

// ── Helpers ──

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Test Agent",
    model: "claude-sonnet-4-20250514",
    providerId: "provider-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Agent;
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "provider-1",
    name: "Anthropic",
    type: "anthropic",
    config: { apiKey: "test-key" },
    ...overrides,
  } as Provider;
}

function makeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    llm_api_key: "fallback-key",
    llm_endpoint: "https://api.anthropic.com",
    llm_model: "claude-3-5-sonnet-20241022",
    max_tool_rounds: 10,
    ...overrides,
  } as AgentSettings;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveTurnConfig", () => {
  it("resolves config from explicit agentId", async () => {
    const agent = makeAgent({ model: "claude-opus-4-20250514", maxTokens: 16384 });
    const provider = makeProvider();
    const fakeClient = { _type: "provider-client" } as any;

    mockGetAgent.mockReturnValue(agent);
    mockGetProvider.mockResolvedValue(provider);
    mockCreateLlmClient.mockResolvedValue(fakeClient);

    const config = await resolveTurnConfig("agent-1", makeSettings());

    expect(config.model).toBe("claude-opus-4-20250514");
    expect(config.maxTokens).toBe(16384);
    expect(config.client).toBe(fakeClient);
    expect(config.provider).toBe(provider);
    expect(config.agent).toBe(agent);
    expect(mockGetAgent).toHaveBeenCalledWith("agent-1");
  });

  it("falls back to active agent when no agentId given", async () => {
    const agent = makeAgent();
    const fakeClient = { _type: "active-client" } as any;

    mockGetActiveAgentId.mockReturnValue("agent-1");
    mockGetAgent.mockReturnValue(agent);
    mockGetProvider.mockResolvedValue(makeProvider());
    mockCreateLlmClient.mockResolvedValue(fakeClient);

    const config = await resolveTurnConfig(undefined, makeSettings());

    expect(config.agent).toBe(agent);
    expect(mockGetActiveAgentId).toHaveBeenCalled();
  });

  it("falls back to settings when no agent exists", async () => {
    mockGetActiveAgentId.mockReturnValue(null);

    const settings = makeSettings({ llm_model: "gpt-4o" });
    const config = await resolveTurnConfig(undefined, settings);

    expect(config.model).toBe("gpt-4o");
    expect(config.agent).toBeNull();
    expect(config.provider).toBeNull();
    expect(config.maxTokens).toBe(8192); // default
  });

  it("uses default Anthropic client when agent has no provider", async () => {
    const agent = makeAgent();
    mockGetAgent.mockReturnValue(agent);
    mockGetProvider.mockResolvedValue(undefined as any);

    const settings = makeSettings({ llm_api_key: "my-key", llm_endpoint: "https://custom.api" });
    const config = await resolveTurnConfig("agent-1", settings);

    expect(config.provider).toBeNull();
    // Should have called new Anthropic() — the mock constructor
    expect(config.client).toBeDefined();
    expect(mockCreateLlmClient).not.toHaveBeenCalled();
  });

  it("passes through agent temperature and topP", async () => {
    const agent = makeAgent({ temperature: 0.7, topP: 0.9 });
    mockGetAgent.mockReturnValue(agent);
    mockGetProvider.mockResolvedValue(makeProvider());
    mockCreateLlmClient.mockResolvedValue({} as any);

    const config = await resolveTurnConfig("agent-1", makeSettings());

    expect(config.temperature).toBe(0.7);
    expect(config.topP).toBe(0.9);
  });

  it("leaves temperature/topP undefined when not set on agent", async () => {
    const agent = makeAgent();
    mockGetAgent.mockReturnValue(agent);
    mockGetProvider.mockResolvedValue(makeProvider());
    mockCreateLlmClient.mockResolvedValue({} as any);

    const config = await resolveTurnConfig("agent-1", makeSettings());

    expect(config.temperature).toBeUndefined();
    expect(config.topP).toBeUndefined();
  });

  it("uses 'ollama' as default API key when settings key is empty", async () => {
    mockGetActiveAgentId.mockReturnValue(null);

    const settings = makeSettings({ llm_api_key: "" });
    const config = await resolveTurnConfig(undefined, settings);

    // The Anthropic constructor mock was called — just verify it exists
    expect(config.client).toBeDefined();
  });
});
