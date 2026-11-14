import { parseWebArgs, type WebArgs } from "./web.ts";

/** What `golem` does with no command, or with only the options of the page. */
export type DefaultRoute = { kind: "tui" } | { kind: "web"; args: WebArgs; hint: boolean };

/** The hint printed when bare `golem` opens the browser. */
export const TUI_HINT = "Chat in the terminal: golem tui";

/** True over SSH, where a browser cannot open here. Applies to `golem` and `golem web`. */
export function noBrowser(env: Record<string, string | undefined>): boolean {
  return env.SSH_CONNECTION !== undefined && env.SSH_CONNECTION !== "";
}

/**
 * `golem` and `golem --port N | --no-open | --json` open the web UI. `golem tui` opens the terminal chat.
 * Over SSH a browser cannot open here, so the link prints straight away, as with `--no-open`.
 * The hint is for someone who expected the terminal chat, so `--json` and a link without a browser skip it.
 * Null for any other command.
 */
export function routeDefault(args: string[], env: Record<string, string | undefined>): DefaultRoute | null {
  if (args[0] === "tui") return args.length === 1 ? { kind: "tui" } : null;
  if (!args.every((arg, i) => arg.startsWith("--") || (i > 0 && args[i - 1] === "--port"))) return null;
  const parsed = parseWebArgs(args);
  if (parsed === null || parsed.serve) return null;
  const web = noBrowser(env) ? { ...parsed, open: false } : parsed;
  return { kind: "web", args: web, hint: web.open };
}
