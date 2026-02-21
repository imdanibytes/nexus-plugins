import type Anthropic from "@anthropic-ai/sdk";
import type {
  AfterRoundContext, AfterRoundAction, RoundLoopCallbacks,
} from "./types.js";
import type { ExecutionStrategyConfig, ModelTierName } from "../types.js";
import { runSubAgent } from "../sub-agent/runner.js";
import { getModelTier } from "../config/model-tiers.js";
import { getAgent } from "../config/agents.js";
import { getProvider } from "../config/providers.js";
import { createLlmClient } from "../config/client-factory.js";
import { getMcpClient } from "../protocol/mcp-client.js";
import { EventType } from "../ag-ui-types.js";

// ── Code-producing tool detection ──

const CODE_PRODUCING_PATTERNS = [
  /write_file$/,
  /edit_file$/,
  /create_file$/,
  /nexus_write_file$/,
  /nexus_edit_file$/,
];

function isCodeProducingRound(toolNames: string[]): boolean {
  return toolNames.some((name) =>
    CODE_PRODUCING_PATTERNS.some((p) => p.test(name)),
  );
}

// ── Tier resolution (reuses delegate.ts pattern) ──

async function resolveFromTier(tierName: ModelTierName) {
  const agentId = getModelTier(tierName);
  if (!agentId) return null;
  const agent = getAgent(agentId);
  if (!agent) return null;
  const provider = await getProvider(agent.providerId);
  if (!provider) return null;
  const client = await createLlmClient(provider);
  return {
    client,
    model: agent.model,
    maxTokens: agent.maxTokens ?? 8192,
    temperature: agent.temperature,
  };
}

// ── Critique system prompt ──

const CRITIQUE_SYSTEM_PROMPT = [
  "You are a code reviewer. Analyze the code changes for:",
  "- Logic errors and edge cases",
  "- Security vulnerabilities (injection, XSS, SSRF, path traversal)",
  "- Missing error handling at system boundaries",
  "- API contract violations",
  "",
  "If the code is correct and well-written, respond with exactly: 'No issues found.'",
  "If there are problems, list them with severity (critical/warning/note) and specific fixes.",
  "Be concise. Only flag real issues, not style preferences.",
].join("\n");

// ── Enhanced Strategy ──

export class EnhancedStrategy {
  readonly name = "enhanced";
  private config: ExecutionStrategyConfig;
  private verifyRetries = 0;

  constructor(config: ExecutionStrategyConfig) {
    this.config = config;
  }

  /** Extract round loop callbacks for use by the graph runtime. */
  getCallbacks(): RoundLoopCallbacks {
    this.verifyRetries = 0;
    return {
      afterRound: (ctx) => this.afterRound(ctx),
    };
  }

  private async afterRound(ctx: AfterRoundContext): Promise<AfterRoundAction> {
    if (ctx.signal.aborted) return { type: "continue" };

    // Only trigger on code-producing rounds
    const toolNames = ctx.assistantPartsThisRound
      .filter((p) => p.type === "tool-call")
      .map((p) => (p as { type: "tool-call"; name: string }).name);

    if (!isCodeProducingRound(toolNames)) return { type: "continue" };

    const injectedMessages: Anthropic.MessageParam[] = [];
    const extraUsage = { input: 0, output: 0 };

    // ── Self-Critique ──
    if (this.config.selfCritique?.enabled) {
      const critiqueSpan = ctx.turnSpan.span("critique", { round: ctx.round });

      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "strategy_step",
        value: { step: "critique", status: "started", round: ctx.round },
      });

      const critiqueResult = await this.runCritique(ctx);

      critiqueSpan.setMetadata("hasIssues", critiqueResult.hasIssues);
      critiqueSpan.setMetadata("critiqueInputTokens", critiqueResult.tokenUsage.input);
      critiqueSpan.setMetadata("critiqueOutputTokens", critiqueResult.tokenUsage.output);
      critiqueSpan.end();

      ctx.sse.writeEvent(EventType.CUSTOM, {
        name: "strategy_step",
        value: {
          step: "critique",
          status: "finished",
          round: ctx.round,
          hasIssues: critiqueResult.hasIssues,
          tokenUsage: critiqueResult.tokenUsage,
        },
      });

      if (critiqueResult.hasIssues && critiqueResult.feedback) {
        injectedMessages.push({
          role: "user",
          content:
            `<code_review>\n` +
            `A code reviewer found the following issues with your most recent changes. ` +
            `Address them in your next edit:\n\n` +
            `${critiqueResult.feedback}\n` +
            `</code_review>`,
        });
        extraUsage.input += critiqueResult.tokenUsage.input;
        extraUsage.output += critiqueResult.tokenUsage.output;
      }
    }

    // ── Verification ──
    if (this.config.verification?.enabled) {
      const maxRetries = this.config.verification.maxRetries ?? 2;

      if (this.verifyRetries < maxRetries) {
        const verifySpan = ctx.turnSpan.span("verification", { round: ctx.round });

        ctx.sse.writeEvent(EventType.CUSTOM, {
          name: "strategy_step",
          value: { step: "verification", status: "started", round: ctx.round },
        });

        const verifyResult = await this.runVerification(ctx);

        verifySpan.setMetadata("passed", verifyResult.passed);
        verifySpan.setMetadata("commands", verifyResult.commandResults.length);
        verifySpan.end();

        ctx.sse.writeEvent(EventType.CUSTOM, {
          name: "strategy_step",
          value: {
            step: "verification",
            status: "finished",
            round: ctx.round,
            passed: verifyResult.passed,
            commands: verifyResult.commandResults.length,
          },
        });

        if (!verifyResult.passed) {
          this.verifyRetries++;
          const errorSummary = verifyResult.commandResults
            .filter((r) => !r.passed)
            .map((r) => `$ ${r.command}\n${r.output}`)
            .join("\n\n");

          injectedMessages.push({
            role: "user",
            content:
              `<verification_errors>\n` +
              `The following verification checks failed after your changes. Fix the errors:\n\n` +
              `${errorSummary}\n\n` +
              `(Retry ${this.verifyRetries}/${maxRetries})\n` +
              `</verification_errors>`,
          });
        }
      }
    }

    if (injectedMessages.length > 0) {
      return {
        type: "inject_and_continue",
        messages: injectedMessages,
        extraUsage: extraUsage.input > 0 ? extraUsage : undefined,
      };
    }

    return { type: "continue" };
  }

  private async runCritique(ctx: AfterRoundContext): Promise<{
    hasIssues: boolean;
    feedback: string | null;
    tokenUsage: { input: number; output: number };
  }> {
    const critiqueTier =
      this.config.routing?.critique ??
      this.config.selfCritique?.tier ??
      "powerful";

    const tierConfig = await resolveFromTier(critiqueTier);
    const client = tierConfig?.client ?? ctx.config.client;
    const model = tierConfig?.model ?? ctx.config.model;

    // Build critique context from recent tool results
    const recentCode = ctx.assistantPartsThisRound
      .filter((p) => p.type === "tool-call")
      .map((p) => {
        const tc = p as {
          type: "tool-call";
          name: string;
          args: Record<string, unknown>;
          result?: string;
        };
        return (
          `Tool: ${tc.name}\n` +
          `Args: ${JSON.stringify(tc.args, null, 2)}\n` +
          `Result: ${tc.result?.slice(0, 3000) ?? "(no result)"}`
        );
      })
      .join("\n\n---\n\n");

    try {
      const result = await runSubAgent({
        client,
        model,
        maxTokens: tierConfig?.maxTokens ?? 4096,
        temperature: tierConfig?.temperature,
        systemPrompt: CRITIQUE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Review the following code changes for correctness, security, and quality issues:\n\n${recentCode}`,
          },
        ],
        maxRounds: 1,
        signal: ctx.signal,
      });

      // Parse — if the reviewer says "no issues found" or similar, no issues
      const text = result.text.trim();
      const hasIssues =
        !text.toLowerCase().includes("no issues found") &&
        !text.toLowerCase().startsWith("looks good") &&
        text.length > 50;

      return {
        hasIssues,
        feedback: hasIssues ? text : null,
        tokenUsage: result.tokenUsage,
      };
    } catch (err) {
      console.warn("[enhanced-strategy] critique failed:", err);
      return { hasIssues: false, feedback: null, tokenUsage: { input: 0, output: 0 } };
    }
  }

  private async runVerification(ctx: AfterRoundContext): Promise<{
    passed: boolean;
    commandResults: { command: string; passed: boolean; output: string }[];
  }> {
    const commands = this.config.verification?.commands ?? [];
    if (commands.length === 0) return { passed: true, commandResults: [] };

    const results: { command: string; passed: boolean; output: string }[] = [];

    try {
      const client = await getMcpClient();

      for (const cmd of commands) {
        if (ctx.signal.aborted) break;

        const parts = cmd.split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        try {
          const mcpResult = await client.callTool({
            name: "nexus.execute_command",
            arguments: { command, args, timeout_secs: 30 },
          });

          const text = (mcpResult.content as { type: string; text: string }[])
            .map((c) => c.text)
            .join("\n");

          let exitCode = -1;
          let stdout = "";
          let stderr = "";
          try {
            const parsed = JSON.parse(text);
            exitCode = parsed.exit_code ?? -1;
            stdout = parsed.stdout ?? "";
            stderr = parsed.stderr ?? "";
          } catch {
            stdout = text;
          }

          const passed = exitCode === 0;
          results.push({
            command: cmd,
            passed,
            output: (stdout + "\n" + stderr).trim().slice(0, 3000),
          });
        } catch (err) {
          results.push({
            command: cmd,
            passed: false,
            output: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    } catch (err) {
      console.warn("[enhanced-strategy] verification failed:", err);
      return { passed: true, commandResults: [] };
    }

    return {
      passed: results.every((r) => r.passed),
      commandResults: results,
    };
  }
}
