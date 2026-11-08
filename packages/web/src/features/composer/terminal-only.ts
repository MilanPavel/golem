/** The commands the page does not have yet. The Commands dialog marks them, and running one says where it lives. */
export const TERMINAL_ONLY: ReadonlySet<string> = new Set([
  "/artifact",
  "/debug",
  "/skills",
]);

export const IN_TERMINAL_LABEL = "In the terminal for now";

/** `golem, then /name`, the words every not-yet notice ends with. */
function inTerminal(what: string, name: string): string {
  return `${what} in the terminal for now: run golem, then ${name}.`;
}

export const NOT_YET = {
  skills: inTerminal("The skills list is", "/skills"),
  artifact: inTerminal("Tool output opens", "/artifact"),
  debug: inTerminal("The debug panel is", "/debug"),
  sessions: "The sidebar lists your sessions.",
} as const;

export const NEEDS_SESSION = "Start a session first: send a message.";
