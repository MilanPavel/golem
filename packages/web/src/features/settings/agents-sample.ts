import type { AgentInfo } from "../../store/agents.ts";

/** Agent types as the gallery and the tests show them: bundled, yours, a project's, a blocked one and a broken one. */
export const SAMPLE_AGENTS: AgentInfo[] = [
  { name: "docs", description: "Writes the docs of a change.", origin: "project", wish: "same", tools: ["Read", "Write"], used: 3, finished: 3 },
  { name: "release", description: "Prepares a release.", origin: "project", wish: "stronger", trusted: false, used: 0, finished: 0 },
  { name: "triage", description: "Sorts new issues.", origin: "user", wish: "cheapest", tools: ["Read"], used: 12, finished: 10 },
  { name: "broken-one", description: "", origin: "user", wish: "cheapest", errors: ["the frontmatter is not valid YAML: line 3: expected ',' or ']'"], used: 0, finished: 0 },
  { name: "explorer", description: "Reads and searches the code.", origin: "bundled", wish: "cheapest", tools: ["Read", "Grep", "Glob"], used: 41, finished: 39 },
  { name: "reviewer", description: "Reads a change and says what is wrong.", origin: "bundled", wish: "stronger", tools: ["Read", "Grep"], used: 20, finished: 19 },
  { name: "advisor", description: "Gives a second opinion.", origin: "bundled", wish: "stronger", used: 4, finished: null },
  { name: "worker", description: "Makes a change.", origin: "bundled", wish: "cheapest", asks: true, used: 0, finished: 0 },
];

const types = (resolves: Record<string, AgentInfo["resolves_to"]>, wishes: Record<string, string>): AgentInfo[] =>
  (
    [
    { name: "explorer", description: "Reads and searches the code.", origin: "bundled", wish: "cheapest", used: 41, finished: 39 },
    { name: "reviewer", description: "Reads a change and says what is wrong.", origin: "bundled", wish: "stronger", used: 20, finished: 19 },
    { name: "worker", description: "Makes a change.", origin: "bundled", wish: "same", asks: true, used: 3, finished: 3 },
    { name: "triage", description: "Sorts new issues.", origin: "user", wish: "cheapest", used: 12, finished: 10 },
    { name: "broken-one", description: "", origin: "user", wish: "cheapest", errors: ["the frontmatter is not valid YAML: line 3"], used: 0, finished: 0 },
    ] satisfies AgentInfo[]
  ).map((agent): AgentInfo => {
    const resolution = resolves[agent.name];
    return { ...agent, wish: wishes[agent.name] ?? agent.wish, ...(resolution === undefined ? {} : { resolves_to: resolution }) };
  });

/** A setup with local models only: nothing hosted is said, and `stronger` is the same model in a fresh window. */
export const WISH_AGENTS_LOCAL: AgentInfo[] = types(
  {
    explorer: { model: "qwen3:8b", tier: "local", reason: "the smallest local model that fits", fresh_window: false },
    reviewer: { model: "qwen3:14b", tier: "local", reason: "no larger local model, so the same one with a fresh window", fresh_window: true },
    worker: { model: "qwen3:14b", tier: "local", reason: "the lead's model", fresh_window: false },
    triage: { model: "qwen3:8b", tier: "local", reason: "the smallest local model that fits", fresh_window: false },
  },
  {},
);

/** A setup with cloud models only: nothing local is said. */
export const WISH_AGENTS_CLOUD: AgentInfo[] = types(
  {
    explorer: { model: "claude-haiku", tier: "budget", reason: "the cheapest model that fits", fresh_window: false },
    reviewer: { model: "claude-opus", tier: "frontier", reason: "one step above the lead", fresh_window: false },
    worker: { model: "claude-sonnet", tier: "frontier", reason: "the lead's model", fresh_window: false },
    triage: { model: "claude-haiku", tier: "budget", reason: "the cheapest model that fits", fresh_window: false },
  },
  {},
);

/** Both: a local model for cheap jobs, a hosted one when the wish asks for more. */
export const WISH_AGENTS_MIXED: AgentInfo[] = types(
  {
    explorer: { model: "qwen3:14b", tier: "local", reason: "the cheapest model that fits, a local one first", fresh_window: false },
    reviewer: { model: "claude-sonnet", tier: "frontier", reason: "one step above the lead", fresh_window: false },
    worker: { model: "claude-sonnet", tier: "frontier", reason: "the lead's model", fresh_window: false },
    triage: { model: "qwen3:14b", tier: "local", reason: "the cheapest model that fits, a local one first", fresh_window: false },
  },
  { triage: "local" },
);
