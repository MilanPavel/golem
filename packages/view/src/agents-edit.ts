import type { AgentOrigin } from "./agents-view.ts";

/** One reason a save was refused: the daemon's words and the line of the text, or null when it has none. */
export interface AgentProblem {
  message: string;
  line?: number | null;
}

/** A problem as one line: `Line 5: there is no tool named "read_files"`, or the message alone. */
export function agentProblemText(problem: AgentProblem): string {
  return problem.line === null || problem.line === undefined ? problem.message : `Line ${problem.line}: ${problem.message}`;
}

/** What an agent offers by where it comes from. */
export interface AgentActions {
  /** "Make my own copy": only a bundled agent. */
  copy: boolean;
  /** "Edit": only your own agent, and only when the daemon sent its file. */
  edit: boolean;
  /** "Delete": only your own agent. */
  remove: boolean;
}

/** A bundled agent can be copied; yours can be edited and deleted; a project agent is read-only here. */
export function agentActions(origin: AgentOrigin, hasText: boolean): AgentActions {
  return { copy: origin === "bundled", edit: origin === "user" && hasText, remove: origin === "user" };
}

/** The key of an agent in the list: a project and a user agent may share a name. */
export function agentKey(agent: { origin: AgentOrigin; name: string }): string {
  return `${agent.origin}/${agent.name}`;
}

/** The head's line for a copy of a bundled agent: `replaces the bundled explorer`. Null when nothing is replaced. */
export function replacesLine(name: string, shadowed: readonly AgentOrigin[]): string | null {
  return shadowed.includes("bundled") ? `replaces the bundled ${name}` : null;
}

/** The question before a delete: a copy says the bundled one comes back. */
export function deleteQuestion(shadowed: readonly AgentOrigin[]): string {
  return shadowed.includes("bundled") ? "Delete your copy and go back to the bundled one?" : "Delete this agent?";
}

/** The note under the file of an agent. */
export function definitionNote(origin: AgentOrigin, shadowed: readonly AgentOrigin[]): string | null {
  if (origin === "bundled") return "This file ships with golem and updates with it. To change the prompt, tools or limits, make your own copy; it wins over this one.";
  if (origin !== "user") return null;
  return shadowed.includes("bundled")
    ? "Your copy replaces the bundled agent of the same name. Delete it to get the bundled one back."
    : "Saved changes apply to the next helper that starts.";
}

/** The key to choose after a save, a copy or a delete: the agent the daemon answered with, or null for the first one. */
export function selectionAfter(agent: { origin: AgentOrigin; name: string } | null | undefined): string | null {
  return agent === null || agent === undefined ? null : agentKey(agent);
}

/** Whether leaving the editor would drop text. */
export function hasUnsavedText(text: string, original: string): boolean {
  return text !== original;
}
