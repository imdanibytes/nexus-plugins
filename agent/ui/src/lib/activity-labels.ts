/** Maps tool names to human-readable activity labels for the streaming indicator. */
const TOOL_LABELS: Record<string, string> = {
  "codebase-indexer.search": "Searching code...",
  "codebase-indexer_search": "Searching code...",
  "nexus_read_file": "Reading files...",
  "nexus.read_file": "Reading files...",
  "nexus_write_file": "Writing code...",
  "nexus.write_file": "Writing code...",
  "nexus_edit_file": "Editing code...",
  "nexus.edit_file": "Editing code...",
  "nexus_execute_command": "Running command...",
  "nexus.execute_command": "Running command...",
  "nexus_search_content": "Searching code...",
  "nexus.search_content": "Searching code...",
  "nexus_search_files": "Searching files...",
  "nexus.search_files": "Searching files...",
  "nexus_fetch_url": "Fetching URL...",
  "nexus.fetch_url": "Fetching URL...",
  "nexus_list_directory": "Browsing files...",
  "nexus.list_directory": "Browsing files...",
  "nexus_directory_tree": "Browsing files...",
  "nexus.directory_tree": "Browsing files...",
};

export function toolToActivity(toolName: string): string {
  return TOOL_LABELS[toolName] ?? "Running tool...";
}

export function strategyStepToActivity(
  step: string,
  status: string,
): string {
  if (status !== "started") return "Thinking...";
  if (step === "critique") return "Reviewing code...";
  if (step === "verification") return "Verifying...";
  return "Processing...";
}
