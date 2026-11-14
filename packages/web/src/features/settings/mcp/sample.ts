import type { McpCatalogEntry } from "@golem/view";
import type { McpImportScanResult } from "../../../store/mcp.ts";

/** What the Catalog and Import tabs draw in the gallery: a few catalog entries, and what a scan of other apps finds. */

function entry(id: string, title: string, description: string, category: McpCatalogEntry["category"], extra: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return { id, name: id, title, description, category, homepage: "https://example.com", runtime: "npx", auth: "none", ...extra } as McpCatalogEntry;
}

export const SAMPLE_CATALOG: McpCatalogEntry[] = [
  entry("filesystem", "Filesystem", "Read and write files in folders you choose.", "files", { inputs: [{ id: "folder", kind: "path", label: "Folder", required: true }] }),
  entry("fetch", "Fetch", "Fetch a web page and turn it into text.", "web"),
  entry("git", "Git", "Read history, diffs and branches of a repo.", "code", { inputs: [{ id: "repo", kind: "path", label: "Repository", required: true }] }),
  entry("github", "GitHub", "Issues, pull requests and code search.", "code", { added: true, runtime: "url", auth: "token" }),
  entry("playwright", "Playwright", "Drive a real browser: click, type, screenshot.", "web"),
  entry("brave-search", "Brave Search", "Web search with the Brave API.", "web", { inputs: [{ id: "token", kind: "secret", label: "API key" }], auth: "token" }),
  entry("context7", "Context7", "Up-to-date library docs in the prompt.", "code"),
  entry("linear", "Linear", "Issues and projects.", "productivity", { runtime: "url", auth: "oauth", available: false, reason: "Needs sign-in." }),
  entry("zed", "A server with no mark", "Shows its first letter.", "other"),
];

export const SAMPLE_SCAN = {
  scan_id: "gallery",
  sources: [
    {
      id: "claude-code",
      label: "Claude Code",
      path: "~/.claude.json",
      candidates: [
        { key: "a", name: "wd-proteus", original_name: "wd-proteus", scope: "user", config: { command: "/Users/me/code/work/proteus/services/mcp/.venv/bin/python", args: ["run_server.py"] } },
        { key: "b", name: "wd-redshift", original_name: "wd-redshift", scope: "user", config: { command: "uvx", args: ["redshift-mcp-server", "--cluster", "analytics-prod", "--region", "eu-west-1"] } },
        { key: "c", name: "wd-x2-2", original_name: "wd-x2", scope: "user", clash: true, config: { url: "http://localhost:12050/mcp" } },
      ],
    },
    {
      id: "cursor",
      label: "Cursor",
      path: "~/.cursor/mcp.json",
      candidates: [
        { key: "d", name: "github", original_name: "github", scope: "user", already_same: true, config: { url: "https://api.githubcopilot.com/mcp/" } },
        { key: "e", name: "context7", original_name: "context7", scope: "user", config: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
      ],
    },
  ],
} as McpImportScanResult;
