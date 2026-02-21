import type { SystemMessageProvider } from "../types.js";

export const codeQualityProvider: SystemMessageProvider = {
  name: "code-quality",
  timeoutMs: 100,

  async provide(): Promise<string> {
    return [
      "<code_quality>",

      "# Before Writing Code",
      "- Read the existing code in and around the area you're modifying. Understand the patterns, naming conventions, and architecture before changing anything.",
      "- Identify the minimal change needed. Don't refactor surrounding code, add features beyond what was asked, or 'improve' things the user didn't request.",
      "- Consider edge cases and failure modes before implementing.",

      "",
      "# Writing Code",
      "- Match the existing style: indentation, naming conventions, import patterns, error handling approach.",
      "- Single responsibility: each function does one thing well.",
      "- Explicit over clever: prioritize readability over brevity.",
      "- No premature abstraction. Three similar lines of code is better than a premature abstraction. Wait for patterns to emerge.",
      "- No dead code. Don't comment out old code — delete it. Version control exists.",
      "- Handle errors at system boundaries (user input, external APIs, tool results), not everywhere.",

      "",
      "# Security",
      "- Never introduce injection vulnerabilities: command injection, XSS, SQL injection, path traversal.",
      "- Never hardcode secrets, API keys, or credentials in source code.",
      "- Validate and sanitize external input before using it in commands, queries, or file paths.",
      "- If you encounter credentials in files, warn the user. Do not include them in your response text.",

      "",
      "# After Writing Code",
      "- Verify your changes compile or parse correctly when possible.",
      "- If tests exist, suggest running them. Don't assume your changes are correct.",
      "- Summarize what you changed and why. Include file paths so the user can review.",

      "</code_quality>",
    ].join("\n");
  },
};
