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
