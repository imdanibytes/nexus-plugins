import type { SystemMessageProvider, SystemMessageContext } from "../types.js";

export const toolGuidanceProvider: SystemMessageProvider = {
  name: "tool-guidance",
  timeoutMs: 100,

  async provide(ctx: SystemMessageContext): Promise<string | null> {
    if (ctx.toolNames.length === 0) return null;

    const sections: string[] = ["<tool_guidance>"];

    // General principles
    sections.push(
      "# Tool Usage Principles",
      "- Read before writing. Always examine a file's contents before modifying it.",
      "- Search before guessing. Use search tools to find file paths, function names, and patterns rather than guessing or hallucinating paths.",
      "- Prefer precision. Use edit_file for targeted changes to existing files. Use write_file only when creating new files or rewriting entire contents.",
      "- Minimize round trips. Use batch_call to execute multiple independent tool calls in parallel (e.g. reading several files at once).",
      "- Use directory_tree to understand project structure before diving into individual files.",
      "- Check tool results. If a tool returns an error, read the error message carefully before retrying. Don't blindly retry the same call.",
      "",
    );

    // Contextual guidance based on available tools
    const names = new Set(ctx.toolNames);

    if (hasAny(names, ["nexus__read_file", "nexus__write_file", "nexus__edit_file"])) {
      sections.push(
        "# File Operations",
        "- read_file before edit_file — always verify current content before making changes.",
        "- edit_file for surgical changes (fix a function, update a config value). The old_string must match exactly.",
        "- write_file for new files or complete rewrites. Creates parent directories automatically.",
        "- Files over 5 MB are rejected. The Nexus data directory is blocked.",
        "",
      );
    }

    if (hasAny(names, ["nexus__search_files", "nexus__search_content"])) {
      sections.push(
        "# Search",
        "- search_files for finding files by name pattern (glob): '**/*.ts', 'src/**/*.test.*'",
        "- search_content for finding code patterns inside files (regex): function definitions, imports, usage.",
        "- Always narrow searches with a path and include filter to avoid noisy results.",
        "- Combine: search_files to find relevant files, then search_content to find specific code within them.",
        "",
      );
    }

    if (hasAny(names, ["nexus__directory_tree"])) {
      sections.push(
        "# Project Exploration",
        "- Use directory_tree at the start to understand project layout before doing anything else.",
        "- Depth 2-3 is usually sufficient for orientation. Increase for deep exploration.",
        "",
      );
    }

    if (hasAny(names, ["nexus__execute_command"])) {
      sections.push(
        "# Command Execution",
        "- Requires user approval each time. Keep commands focused and explainable.",
        "- Pass command and args separately — do not combine into a shell string.",
        "- Set working_dir for project-scoped commands.",
        "- Use dedicated file tools instead of cat, grep, sed, find — they're faster and don't need approval.",
        "- Set appropriate timeout_secs for long-running commands (builds, tests). Default is 30s.",
        "",
      );
    }

    if (hasAny(names, ["nexus__fetch_url"])) {
      sections.push(
        "# Web Fetching",
        "- HTML responses are automatically converted to Markdown. Links, headers, and structure are preserved.",
        "- Present fetched content faithfully. Do not fabricate data not present in the response.",
        "- For APIs, set appropriate headers (Content-Type, Authorization) via the headers parameter.",
        "",
      );
    }

    if (hasAny(names, ["batch_call"])) {
      sections.push(
        "# Batch Calls",
        "- Use batch_call when you need results from multiple independent tools before continuing.",
        "- Good examples: reading 3 files at once, checking multiple endpoints, searching in parallel.",
        "- Bad examples: sequential operations where step 2 depends on step 1's output.",
        "- Maximum 20 calls per batch. Server-side tools only.",
        "",
      );
    }

    if (hasAny(names, ["delegate"])) {
      sections.push(
        "# Delegation",
        "- Use delegate for tasks requiring focused expertise: architecture, code review, security audit, test planning.",
        "- The sub-agent has NO conversation history. Pass all relevant context explicitly.",
        "- Don't delegate simple questions you can answer directly — it adds latency and cost.",
        "",
      );
    }

    sections.push("</tool_guidance>");
    return sections.join("\n");
  },
};

function hasAny(available: Set<string>, candidates: string[]): boolean {
  return candidates.some((c) => available.has(c));
}
