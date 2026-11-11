/** The permission modes, from least to most the built-in defaults allow without asking. */
export type PermissionMode = "careful" | "balanced" | "autopilot";

export const PERMISSION_MODES: readonly PermissionMode[] = ["careful", "balanced", "autopilot"];

export const MODE_LABEL: Readonly<Record<PermissionMode, string>> = {
  careful: "Careful",
  balanced: "Balanced",
  autopilot: "Autopilot",
};

/** One line for each mode, the same words in the web menu, Settings and the terminal. */
export const MODE_HINT: Readonly<Record<PermissionMode, string>> = {
  careful: "Asks before anything that is not a read.",
  balanced: "Also runs web search and web fetch.",
  autopilot: "Also edits inside the project and runs the sandboxed shell when it has no network.",
};

/** What stays asking in every mode. */
export const MODE_ALWAYS_ASKS = "The unsandboxed shell, paths outside the project and MCP tools always ask.";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "careful" || value === "balanced" || value === "autopilot";
}

/** The mode a session runs in: its own, else the default from config.toml, else balanced. */
export function effectiveMode(session: PermissionMode | null, fallback: string | null | undefined): PermissionMode {
  if (session !== null) return session;
  return isPermissionMode(fallback) ? fallback : "balanced";
}

/** The next mode in the cycle careful, balanced, autopilot, careful. */
export function nextMode(current: PermissionMode): PermissionMode {
  const at = PERMISSION_MODES.indexOf(current);
  return PERMISSION_MODES[(at + 1) % PERMISSION_MODES.length] ?? "balanced";
}

/** The line `/mode` alone prints. */
export function modeReport(current: PermissionMode, fromSession: boolean, fallback: PermissionMode): string {
  return fromSession ? `Mode: ${current}, set for this chat. /mode default follows ${fallback}.` : `Mode: ${current}, the default.`;
}

/** The notice after a change: `null` returns the chat to the default. */
export function modeChanged(mode: PermissionMode | null, fallback: PermissionMode): string {
  return mode === null ? `Mode follows the default: ${fallback}.` : `Mode: ${mode}. ${MODE_HINT[mode]}`;
}
