import { contextReport, type Command, type ContextReport } from "@golem/view";

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
  withTuneChoices,
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

/** `/context`: the view's report, each line cut to the terminal. */
export function contextLines(report: ContextReport, columns: number): string[] {
  return contextReport(report, columns).map((line) => fitLine(line, columns));
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
