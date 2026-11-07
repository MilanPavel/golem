import type { Command, CommandGroup } from "@golem/view";
import type { SearchListItem } from "../../ui/search-list.tsx";

const GROUPS: readonly { group: CommandGroup; title: string }[] = [
  { group: "session", title: "Session" },
  { group: "model", title: "Model" },
  { group: "tools", title: "Tools" },
  { group: "view", title: "View" },
];

export const MESSAGE_GROUP = "Message";

/** The key that does what a command does, when the page has one. Only `/help` for now. */
export const COMMAND_KEYS: Readonly<Record<string, string>> = { "/help": "?" };

/** What a row picks: a slash command, a page action that is not one, or the text as a message. */
export type PaletteRow = SearchListItem &
  (
    | { kind: "command"; command: Command; key: string | null }
    | { kind: "page"; page: "keys" | "settings" | "trace"; name: string; description: string; key: string | null }
    | { kind: "message"; text: string }
  );

const KEYS = { name: "Keys", description: "The keys this page uses.", key: "?" };
const TRACE = { name: "Trace", description: "Model calls, context, tools, and timings of this session", key: null };
const SETTINGS = { name: "Settings", description: "Setup, appearance, and the rest of the settings.", key: null };

/** How well the query fits a name, or null for no fit: 0 when the name starts with it, 1 when the text holds it. */
function rank(name: string, args: string, description: string, query: string): 0 | 1 | null {
  const bare = name.startsWith("/") ? name.slice(1) : name;
  const lower = name.toLowerCase();
  if (query === "" || lower.startsWith(query) || bare.toLowerCase().startsWith(query)) return 0;
  return `${lower} ${args} ${description}`.toLowerCase().includes(query) ? 1 : null;
}

/**
 * The rows for a query: the commands and the Keys row, grouped as Session, Model, Tools, and View,
 * names that start with the query first. The Trace row is there only with a session open. A query that fits nothing is one row that sends it as a message.
 */
export function paletteRows(commands: readonly Command[], query: string, hasSession = false): PaletteRow[] {
  const typed = query.trim();
  const needle = typed.toLowerCase();
  const out: PaletteRow[] = [];
  for (const { group, title } of GROUPS) {
    const found: { row: PaletteRow; rank: 0 | 1 }[] = [];
    for (const command of commands) {
      if (command.group !== group) continue;
      const at = rank(command.name, command.args, command.description, needle);
      if (at !== null) {
        found.push({ row: { id: command.name, group: title, kind: "command", command, key: COMMAND_KEYS[command.name] ?? null }, rank: at });
      }
    }
    if (group === "view") {
      const trace = hasSession ? rank(TRACE.name, "", TRACE.description, needle) : null;
      if (trace !== null) {
        found.push({ row: { id: "page:trace", group: title, kind: "page", page: "trace", ...TRACE }, rank: trace });
      }
      const settings = rank(SETTINGS.name, "", SETTINGS.description, needle);
      if (settings !== null) {
        found.push({ row: { id: "page:settings", group: title, kind: "page", page: "settings", ...SETTINGS }, rank: settings });
      }
      const at = rank(KEYS.name, "", KEYS.description, needle);
      if (at !== null) found.push({ row: { id: "page:keys", group: title, kind: "page", page: "keys", ...KEYS }, rank: at });
    }
    found.sort((a, b) => a.rank - b.rank);
    out.push(...found.map((entry) => entry.row));
  }
  if (out.length === 0 && typed !== "") {
    return [{ id: "message", group: MESSAGE_GROUP, kind: "message", text: typed }];
  }
  return out;
}
