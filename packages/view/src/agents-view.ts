import type { AgentInfo } from "@golem/client";

import type { McpTone } from "./mcp-servers.ts";

/** What the agents list says about an agent type, as words and data: the TUI lays it out, the page draws it. */
export type AgentOrigin = AgentInfo["origin"];

/** The word for where an agent type comes from. */
export const AGENT_SOURCES: Record<AgentOrigin, string> = {
  bundled: "comes with golem",
  project: "this project",
  user: "you",
};

/** The group titles, by where an agent type comes from. */
export const AGENT_GROUPS: Record<AgentOrigin, string> = {
  project: "This project",
  user: "Yours",
  bundled: "Bundled with golem",
};

const WISHES: Record<string, string> = {
  cheapest: "Cheapest that fits",
  same: "Same as the lead",
  stronger: "Stronger than the lead",
  local: "Always local",
  budget: "Always budget",
  frontier: "Always frontier",
};

/** The model wish in words. A model name is shown as it is. */
export function agentWish(wish: string): string {
  return Object.hasOwn(WISHES, wish) ? (WISHES[wish] ?? wish) : wish;
}

/** How many helpers of this type were started, as `41`, or `—` when none were. */
export function agentUsed(agent: AgentInfo): string {
  return (agent.used ?? 0) > 0 ? String(agent.used) : "—";
}

/** The share of started helpers that finished, as `95%`, or `—` when there is nothing to say. */
export function agentFinished(agent: AgentInfo): string {
  const used = agent.used ?? 0;
  if (used <= 0 || agent.finished === null || agent.finished === undefined) {
    return "—";
  }
  return `${Math.round((agent.finished / used) * 100)}%`;
}

/** The warnings: the file's errors, then a note for a project agent that is not trusted. */
export function agentWarnings(agent: AgentInfo): string[] {
  const warnings = [...(agent.errors ?? [])];
  if (agent.origin === "project" && agent.trusted === false) {
    warnings.push("this folder is not trusted, so this agent is never started");
  }
  return warnings;
}

/** One row of the agents list. */
export interface AgentRow {
  name: string;
  description: string;
  source: AgentOrigin;
  sourceLabel: string;
  wish: string;
  used: string;
  finished: string;
  warnings: string[];
  tone: McpTone;
}

/** The row of an agent type. Errors make the tone `bad`; a blocked project agent makes it `wait`. */
export function agentRow(agent: AgentInfo): AgentRow {
  const broken = (agent.errors ?? []).length > 0;
  const warnings = agentWarnings(agent);
  return {
    name: agent.name,
    description: agent.description.trim().split("\n")[0] ?? "",
    source: agent.origin,
    sourceLabel: AGENT_SOURCES[agent.origin],
    wish: agentWish(agent.wish),
    used: agentUsed(agent),
    finished: agentFinished(agent),
    warnings,
    tone: broken ? "bad" : warnings.length > 0 ? "wait" : "ok",
  };
}

/** The rows, in the order the daemon sent them. */
export function agentRows(agents: readonly AgentInfo[]): AgentRow[] {
  return agents.map(agentRow);
}
