import type { SystemMessageProvider, SystemMessageContext } from "../types.js";

export const outputStyleProvider: SystemMessageProvider = {
  name: "output-style",
  timeoutMs: 100,

  async provide(ctx: SystemMessageContext): Promise<string> {
    const sections: string[] = [
      "<output_style>",
      "- Be concise. Lead with the answer or action, not the reasoning. Skip preamble and filler.",
      "- Do not repeat the user's question back to them. Just answer it.",
      "- Use markdown formatting: headings for structure, fenced code blocks with language tags, inline code for identifiers.",
      "- When referencing code, include the file path so the user can navigate to it.",
      "- When showing code changes, show only the relevant diff — not the entire file.",
      "- If a task is complete, say what you did and stop. Don't ask 'is there anything else?' or offer unsolicited next steps.",
    ];

    // Context budget pressure — adjust style as context fills up
    if (ctx.tokenUsage) {
      const pct = ctx.tokenUsage.input / ctx.tokenUsage.limit;
      if (pct > 0.85) {
        sections.push(
          "",
          "⚠ Context window is nearly full. Be extremely concise:",
          "- Summarize tool outputs to essential information only.",
          "- Omit explanations the user didn't ask for.",
          "- If a task requires more context than available, tell the user and suggest starting a new conversation.",
        );
      } else if (pct > 0.65) {
        sections.push(
          "",
          "Context is filling up. Prefer brevity:",
          "- Trim verbose tool outputs when presenting results.",
          "- Focus on what the user asked, skip tangential observations.",
        );
      }
    }

    sections.push("</output_style>");
    return sections.join("\n");
  },
};
