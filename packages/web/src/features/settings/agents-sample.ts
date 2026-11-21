import type { AgentInfo } from "../../store/agents.ts";

/** The file of an agent type: the settings between two `---` lines, then the prompt. */
function file(settings: Record<string, string | number | boolean>, prompt: string): string {
  const lines = Object.entries(settings).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${prompt}\n`;
}

const READ = ["read_file", "list_dir", "glob", "grep", "git_log", "git_diff", "git_status"];
const LIMITS = { max_calls: 15, max_seconds: 300, answer_chars: 6000 };

/** The fields the daemon adds for an agent: its file, the prompt, the limits. */
function described(
  path: string,
  name: string,
  description: string,
  wish: string,
  tools: string[],
  prompt: string,
  limits = LIMITS,
  asks = false,
): Pick<AgentInfo, "path" | "text" | "prompt" | "limits"> {
  return {
    path,
    text: file({ name, description, model: wish, tools: tools.join(", "), "max-calls": limits.max_calls, "max-seconds": limits.max_seconds, "max-answer-chars": limits.answer_chars, asks }, prompt),
    prompt,
    limits,
  };
}

/** Agent types as the gallery and the tests show them: bundled, yours, a project's, a blocked one, a broken one and one that cannot run. */
export const SAMPLE_AGENTS: AgentInfo[] = [
  {
    name: "docs",
    description: "Writes the docs of a change.",
    origin: "project",
    wish: "same",
    tools: ["Read", "Write"],
    used: 3,
    finished: 3,
    ...described(".golem/agents/docs.md", "docs", "Writes the docs of a change.", "same", ["Read", "Write"], "Write the docs of the change in the brief."),
  },
  { name: "release", description: "Prepares a release.", origin: "project", wish: "stronger", trusted: false, used: 0, finished: 0 },
  {
    name: "triage",
    description: "Sorts new issues.",
    origin: "user",
    wish: "cheapest",
    tools: ["Read"],
    used: 12,
    finished: 10,
    stopped: 1,
    cost_usd: 0,
    ...described("~/.golem/agents/triage.md", "triage", "Sorts new issues.", "cheapest", ["Read"], "Sort each new issue by area."),
  },
  { name: "broken-one", description: "", origin: "user", wish: "cheapest", errors: ["the frontmatter is not valid YAML: line 3: expected ',' or ']'"], used: 0, finished: 0 },
  {
    name: "explorer",
    description: "Reads and searches the code.",
    origin: "bundled",
    wish: "cheapest",
    tools: READ,
    used: 41,
    finished: 39,
    resolves_to: { model: "qwen3:14b", tier: "local", reason: "the cheapest model that fits, a local one first", fresh_window: false },
    ...described("golem/agents/bundled/explorer.md", "explorer", "Reads and searches the code.", "cheapest", READ, "You are a helper. Answer the brief. Read only what you need. End with a short answer: findings first, then the paths that matter."),
  },
  {
    name: "reviewer",
    description: "Reads a change and says what is wrong.",
    origin: "bundled",
    wish: "stronger",
    tools: ["read_file", "grep"],
    used: 20,
    finished: 19,
    resolves_to: { model: "claude-sonnet", tier: "frontier", reason: "one step above the lead", fresh_window: false },
    ...described("golem/agents/bundled/reviewer.md", "reviewer", "Reads a change and says what is wrong.", "stronger", ["read_file", "grep"], "You are a reviewer. Say what is wrong, most serious first.", { max_calls: 20, max_seconds: 600, answer_chars: 6000 }),
  },
  {
    name: "advisor",
    description: "Gives a second opinion.",
    origin: "bundled",
    wish: "stronger",
    tools: [],
    used: 4,
    finished: null,
    ...described("golem/agents/bundled/advisor.md", "advisor", "Gives a second opinion.", "stronger", [], "You are an advisor. Work from the brief.", { max_calls: 1, max_seconds: 300, answer_chars: 6000 }),
  },
  {
    name: "worker",
    description: "Makes a change.",
    origin: "bundled",
    wish: "cheapest",
    asks: true,
    used: 0,
    finished: 0,
    tools: ["read_file", "edit_file", "shell"],
    changing_tools: ["edit_file", "shell"],
    unavailable: "worker has tools that change things. Helpers that write come with a later step.",
    ...described("golem/agents/bundled/worker.md", "worker", "Makes a change.", "cheapest", ["read_file", "edit_file", "shell"], "You are a helper that makes one change.", { max_calls: 30, max_seconds: 900, answer_chars: 6000 }, true),
  },
];

/** Your copy of the bundled reviewer: it replaces the bundled one, which the list no longer shows on its own. */
export const SAMPLE_COPY: AgentInfo = {
  name: "reviewer",
  description: "Reads a change and says what is wrong.",
  origin: "user",
  wish: "stronger",
  tools: ["read_file", "grep"],
  shadowed: ["bundled"],
  used: 20,
  finished: 19,
  resolves_to: { model: "claude-sonnet", tier: "frontier", reason: "one step above the lead", fresh_window: false },
  ...described("~/.golem/agents/reviewer.md", "reviewer", "Reads a change and says what is wrong.", "stronger", ["read_file", "grep"], "You are a reviewer. Say what is wrong, most serious first.", { max_calls: 20, max_seconds: 600, answer_chars: 6000 }),
};

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
