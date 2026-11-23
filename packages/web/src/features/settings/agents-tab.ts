import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/** The three tabs of Settings › Agents. */
export type AgentsTab = "agents" | "rules" | "measure";

/**
 * The tab Settings › Agents shows. In memory only: the settings route carries no parameters, and the tab
 * is kept while the page is open, as the section is. A search result for a row on another tab sets it.
 */
export const agentsTabStore = createStore<AgentsTab>("agents");

export function showAgentsTab(tab: AgentsTab): void {
  agentsTabStore.set(tab);
}

export function useAgentsTab(): AgentsTab {
  return useSyncExternalStore(agentsTabStore.subscribe, agentsTabStore.getSnapshot);
}

/** The search keywords whose row is on Rules; every other keyword of the section is on Agents. */
const RULES_KEYWORDS: readonly string[] = ["use helpers", "limits for every helper", "finished helpers"];

/** The tab a search keyword of the Agents section lands on. */
export function agentsTabOf(keyword: string): AgentsTab {
  return RULES_KEYWORDS.includes(keyword.toLowerCase()) ? "rules" : "agents";
}
