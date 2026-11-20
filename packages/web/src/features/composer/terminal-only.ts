/** The commands the page does not have yet. The Commands dialog marks them, and running one says where it lives. */
export const TERMINAL_ONLY: ReadonlySet<string> = new Set([
  "/artifact",
  "/debug",
  "/tune",
  "/undo",
]);

export const IN_TERMINAL_LABEL = "In the terminal for now";

/** `golem tui, then /name`, the words every not-yet notice ends with. */
function inTerminal(what: string, name: string): string {
  return `${what} in the terminal for now: run golem tui, then ${name}.`;
}

export const NOT_YET = {
  artifact: inTerminal("Tool output opens", "/artifact"),
  debug: inTerminal("The debug panel is", "/debug"),
  tune: inTerminal("Tuning a model is", "/tune"),
  undo: inTerminal("Undoing a turn is", "/undo"),
  sessions: "The sidebar lists your sessions.",
  memory: "The memory browser is not here yet.",
} as const;

export const NEEDS_SESSION = "Start a session first: send a message.";
