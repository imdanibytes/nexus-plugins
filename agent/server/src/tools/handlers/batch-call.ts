import { v4 as uuidv4 } from "uuid";
import type { ToolHandler, ToolResult, ToolContext } from "../types.js";
import type { ToolExecutor } from "../executor.js";

/**
 * Factory that creates a batch_call tool handler bound to the given executor.
 * The executor reference is captured at creation — by execution time, all tools
 * are registered on it.
 */
export function createBatchCallTool(executor: ToolExecutor): ToolHandler {
  return {
    definition: {
      name: "batch_call",
      description:
        "Execute multiple tool calls in parallel within a single round. " +
        "Use when you need results from several independent tools before continuing — " +
        "e.g. reading multiple files, running several MCP operations, or gathering data from different sources. " +
        "All calls execute concurrently, saving round trips. " +
        "Returns a JSON array of results, one per call, in the same order. " +
        "Only server-side tools can be batched (not frontend tools). " +
        "Do NOT nest batch_call inside batch_call.",
      input_schema: {
        type: "object",
        properties: {
          calls: {
            type: "array",
            description: "Array of tool calls to execute in parallel",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "The tool name to call",
                },
                args: {
                  type: "object",
                  description: "Arguments to pass to the tool",
                },
              },
              required: ["name", "args"],
            },
          },
        },
        required: ["calls"],
      },
    },

    async execute(
      toolUseId: string,
      args: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const calls = args.calls as
        | Array<{ name: string; args: Record<string, unknown> }>
        | undefined;

      if (!calls || !Array.isArray(calls) || calls.length === 0) {
        return {
          tool_use_id: toolUseId,
          content: "batch_call requires a non-empty 'calls' array",
          is_error: true,
        };
      }

      if (calls.length > 20) {
        return {
          tool_use_id: toolUseId,
          content: "batch_call supports at most 20 calls per batch",
          is_error: true,
        };
      }

      // Validate: no recursive batch_call, no unknown tools
      for (const call of calls) {
        if (call.name === "batch_call") {
          return {
            tool_use_id: toolUseId,
            content: "Cannot nest batch_call inside batch_call",
            is_error: true,
          };
        }
        if (!executor.has(call.name)) {
          return {
            tool_use_id: toolUseId,
            content: `Tool "${call.name}" is not a server-side tool and cannot be batched`,
            is_error: true,
          };
        }
      }

      // Execute all calls in parallel
      const results = await Promise.all(
        calls.map((call) => {
          const subId = uuidv4();
          return executor
            .execute(call.name, subId, call.args ?? {}, ctx)
            .then((r) => ({
              name: call.name,
              content: r.content,
              is_error: r.is_error ?? false,
            }));
        }),
      );

      return {
        tool_use_id: toolUseId,
        content: JSON.stringify(results, null, 2),
      };
    },
  };
}
