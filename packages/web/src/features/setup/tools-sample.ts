import {
  toolsAdded,
  toolsFailed,
  toolsOffer,
  toolsRuntimeOutput,
  toolsSetToken,
  toolsStart,
  toolsStep,
  toolsTick,
  type ToolsState,
} from "@golem/view";
import type { McpCatalogEntry } from "../../store/mcp.ts";

function entry(id: string, title: string, description: string, extra: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return { id, name: id, title, description, category: "web", homepage: "https://example.com", runtime: "npx", auth: "none", starter: true, ...extra };
}

/** The starter servers `mcp.catalog` offers on a Mac that has no Node yet. */
export const TOOLS_CATALOG: McpCatalogEntry[] = [
  entry("fetch", "Fetch", "read any web page", { runtime: "uvx" }),
  entry("context7", "Context7", "up-to-date library docs"),
  entry("playwright", "Playwright", "browse and test web pages", { missing: "node" }),
  entry("github", "GitHub", "repos, issues, pull requests", {
    runtime: "url",
    auth: "token",
    starter: false,
    inputs: [{ id: "token", kind: "secret", label: "GitHub token", hint: "Make one at github.com/settings/personal-access-tokens/new" }],
  }),
];

/** The offer as it opens: the starters ticked, GitHub not. */
export function toolsOffered(mode: ToolsState["mode"] = "guided", catalog: McpCatalogEntry[] = TOOLS_CATALOG): ToolsState {
  return toolsOffer(catalog, mode);
}

/** GitHub ticked: its token field is open and still empty. */
export function toolsGithubTicked(): ToolsState {
  return toolsTick(toolsOffered(), "github");
}

/** Adding four: Fetch and Context7 done, Node installing for Playwright, GitHub refused its token. */
export function toolsAdding(): ToolsState {
  const started = toolsStart(toolsSetToken(toolsGithubTicked(), "github", "sample-token"));
  if (started === null) throw new Error("the sample offer has nothing ticked");
  let state = toolsStep(started).state;
  state = toolsAdded(state, "fetch", 1);
  state = toolsStep(state).state;
  state = toolsAdded(state, "context7", 2);
  state = toolsStep(state).state;
  state = toolsRuntimeOutput(state, "node", "######################                      41.0%\n");
  return toolsFailed(state, "github", "The token was refused (401). Check it has repo access.");
}

export type ToolsCase = { label: string; state: ToolsState };

/** The Tools panel in the states it draws, for the gallery: the welcome page's offer and run, and the Settings card. */
export const TOOLS_CASES: ToolsCase[] = [
  { label: "Tools, the offer", state: toolsOffered() },
  { label: "Tools, GitHub ticked", state: toolsGithubTicked() },
  { label: "Tools, adding", state: toolsAdding() },
  { label: "Tools, Settings card", state: toolsOffered("single", TOOLS_CATALOG.map((each) => (each.id === "fetch" ? { ...each, added: true } : each))) },
];
