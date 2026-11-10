import { contextReportLines, type Command, type ContextKey, type ContextLine, type ContextReport } from "@golem/view";

import { CTX_REPLIES, CTX_RESULTS, CTX_SYSTEM, CTX_TOOLS, CTX_USER, HINT } from "./theme.ts";

export {
  applyComposer,
  closedDebug,
  COMMANDS,
  invocableSkills,
  KEY_PROVIDERS,
  pinnableSkills,
  pinnedNotice,
  toggleDebugTab,
  withModelChoices,
  withSkillChoices,
  type Command,
  type CommandGroup,
  type ComposerOutcome,
  type DebugState,
  type DebugTab,
  type PinChoices,
  type SkillChoice,
} from "@golem/view";

/** One row per command. The lines are the table, and nothing is added around it. */
export function helpLines(commands: readonly Pick<Command, "name" | "args" | "description">[], columns: number): string[] {
  const usage = (command: Pick<Command, "name" | "args">): string =>
    command.args.length > 0 ? `${command.name} ${command.args}` : command.name;
  const width = commands.reduce((max, command) => Math.max(max, usage(command).length), 0);
  return commands.map((command) => fitLine(`${usage(command).padEnd(width)}  ${command.description}`, columns));
}

const PART_COLORS: Record<ContextKey | "free", string> = {
  system: CTX_SYSTEM,
  tools: CTX_TOOLS,
  user: CTX_USER,
  assistant: CTX_REPLIES,
  tool_results: CTX_RESULTS,
  free: HINT,
};

/** `/context`: the view's report as coloured segments, each line cut to the terminal. */
export function contextSegments(report: ContextReport, columns: number): { text: string; color?: string }[][] {
  return contextReportLines(report, columns).map((line) => fitSegments(line, columns));
}

/** `/context` as plain lines, each cut to the terminal. */
export function contextLines(report: ContextReport, columns: number): string[] {
  return contextSegments(report, columns).map((line) => line.map((segment) => segment.text).join(""));
}

function fitSegments(line: ContextLine, columns: number): { text: string; color?: string }[] {
  const cut = fitLine(line.map((segment) => segment.text).join(""), columns);
  const out: { text: string; color?: string }[] = [];
  let at = 0;
  for (const segment of line) {
    const text = cut.slice(at, at + segment.text.length);
    at += segment.text.length;
    if (text.length === 0) continue;
    out.push(segment.part === undefined ? { text } : { text, color: PART_COLORS[segment.part] });
  }
  return out;
}

export function fitLine(text: string, columns: number): string {
  if (columns <= 0) {
    return "";
  }
  if (text.length <= columns) {
    return text;
  }
  if (columns === 1) {
    return "\u2026";
  }
  return `${text.slice(0, columns - 1)}\u2026`;
}
