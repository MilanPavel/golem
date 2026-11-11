import type { ToolBlock } from "./chat-state.ts";

/** `mcp__github__get_me` reads `github · get_me`; any other name is left as it is. */
export function displayToolName(name: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match === null ? name : `${match[1]} · ${match[2]}`;
}

/** The dot of one tool in the activity line. */
export type StepMark = "allow" | "deny" | "wait" | "run";

/** A call that did not succeed: it failed, was denied, or ran and reported it did not work. */
export function stepFailed(tool: ToolBlock): boolean {
  return tool.status === "failed" || (tool.status === "done" && tool.unsuccessful === true);
}

export function stepMark(tool: ToolBlock): StepMark {
  if (stepFailed(tool)) return "deny";
  if (tool.status === "waiting") return "wait";
  return tool.status === "done" ? "allow" : "run";
}

type Group = { count: number; failed: number; label: (count: number) => string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function groupOf(name: string): { key: string; label: Group["label"] } {
  const mcp = /^mcp__(.+?)__.+$/.exec(name);
  if (mcp !== null) {
    const raw = mcp[1] ?? "";
    const server = raw;
    return { key: `mcp:${raw}`, label: (count) => plural(count, `${server} call`, `${server} calls`) };
  }
  switch (name) {
    case "web_search":
      return { key: "search", label: () => "searched the web" };
    case "web_fetch":
      return { key: "fetch", label: (count) => `fetched ${plural(count, "page", "pages")}` };
    case "read_file":
      return { key: "read", label: (count) => `read ${plural(count, "file", "files")}` };
    case "list_dir":
    case "glob":
    case "grep":
      return { key: "files", label: () => "searched files" };
    case "write_file":
    case "edit_file":
      return { key: "edit", label: (count) => `edited ${plural(count, "file", "files")}` };
    case "shell":
      return { key: "shell", label: (count) => `ran ${plural(count, "command", "commands")}` };
    default:
      return { key: "other", label: (count) => plural(count, "tool", "tools") };
  }
}

/**
 * The activity line of a turn: the tools grouped by kind, in the order each kind first
 * appears, with failures counted per group and the approvals at the end. Empty with no tools.
 *
 * `searched the web · read 3 files · 3 GitHub calls, 1 failed · ran 2 commands · 1 approval`
 */
export function summarizeSteps(tools: readonly ToolBlock[]): string {
  const groups = new Map<string, Group>();
  for (const tool of tools) {
    const { key, label } = groupOf(tool.name);
    const group = groups.get(key) ?? { count: 0, failed: 0, label };
    group.count += 1;
    if (stepFailed(tool)) group.failed += 1;
    groups.set(key, group);
  }
  const parts = [...groups.values()].map((group) => `${group.label(group.count)}${group.failed > 0 ? `, ${group.failed} failed` : ""}`);
  const approvals = tools.filter((tool) => tool.approval !== undefined).length;
  if (approvals > 0) parts.push(plural(approvals, "approval", "approvals"));
  return parts.join(" · ");
}

/** The quiet form of the line: `1 step`, `5 steps`. */
export function stepCount(count: number): string {
  return plural(count, "step", "steps");
}

/** The choices of `/detail` and the switch. */
export const DETAILS = ["quiet", "normal", "verbose"] as const;
export type Detail = (typeof DETAILS)[number];

export function isDetail(value: string | null | undefined): value is Detail {
  return (DETAILS as readonly string[]).includes(value ?? "");
}
