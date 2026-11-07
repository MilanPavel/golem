import type { SetupRow } from "@golem/client";

import { pageKeyCommand } from "./setup-key.ts";
import { KEEP_SERVICE_COMMAND, providerName, type SetupAction } from "./setup-window.ts";

/**
 * Settings → Setup as a form: one card for each row of `setup.status`, with the way to fix it
 * in place. It reads the same rows as the terminal's overview and says the same things; only
 * the fix differs, because a page has buttons where the terminal has a list of choices.
 */

export type FormMark = "ok" | "warn" | "fail";

/** A button the page handles itself. */
export type FormButtonId = "install_ollama" | "start_ollama" | "change_model" | "check_again";

export type FormFix =
  /** Something to run in a terminal, shown to copy. The page never installs a service or takes a key. */
  | { kind: "command"; text: string }
  | { kind: "button"; id: FormButtonId; label: string }
  /** A page of the app, by its path, with the words for its link. */
  | { kind: "link"; to: string; label: string };

export type FormRow = {
  part: SetupRow["part"];
  mark: FormMark;
  /** What the mark means in words, so colour is never the only sign. */
  markWord: string;
  name: string;
  detail: string;
  fix: FormFix | null;
};

const MARK_WORDS: Record<FormMark, string> = { ok: "done", warn: "needs attention", fail: "failed" };

const PART_NAMES: Record<SetupRow["part"], string> = {
  service: "Service",
  socket: "Socket",
  config: "Config",
  engine: "Engine",
  model: "Model",
  tools: "Tools",
  disk: "Disk",
};

const PART_ORDER: readonly SetupRow["part"][] = ["service", "socket", "config", "engine", "model", "tools", "disk"];

/** Where the MCP servers are managed. The page shows the link once it has that section. */
export const TOOLS_PATH = "/settings/mcp";

const CHECK_AGAIN: FormFix = { kind: "button", id: "check_again", label: "Check again" };

const BUTTON_FOR: Partial<Record<SetupAction, { id: FormButtonId; label: string }>> = {
  install_ollama: { id: "install_ollama", label: "Install Ollama" },
  start_ollama: { id: "start_ollama", label: "Start Ollama" },
};

function row(source: SetupRow, extra: Partial<FormRow> = {}): FormRow {
  return {
    part: source.part,
    mark: source.state,
    markWord: MARK_WORDS[source.state],
    name: PART_NAMES[source.part],
    detail: source.detail,
    fix: null,
    ...extra,
  };
}

function engineRow(source: SetupRow): FormRow {
  const name = providerName(source.name);
  if (source.action === "set_key") {
    return row(source, { name, fix: { kind: "command", text: pageKeyCommand(source.target ?? source.name) } });
  }
  const button = source.action ? BUTTON_FOR[source.action] : undefined;
  return row(source, { name, fix: button === undefined ? null : { kind: "button", ...button } });
}

function modelRow(source: SetupRow): FormRow {
  const name = source.name === "model" ? "Model" : `Model ${source.name.replace(/^model /, "")}`;
  // Whatever the state, the model can be changed. With none chosen the button says to pick one.
  const label = source.state === "ok" ? "Change…" : "Pick a model…";
  return row(source, { name, fix: { kind: "button", id: "change_model", label } });
}

function configRow(source: SetupRow): FormRow {
  if (source.action !== "edit_config") return row(source);
  // The file is edited by hand, so the way on is to look again afterwards. The daemon's fix names the file.
  const where = source.fix ? ` · ${source.fix}` : "";
  return row(source, { detail: `${source.detail}${where}`, fix: CHECK_AGAIN });
}

function toolRows(rows: readonly SetupRow[]): FormRow[] {
  const manage = (label: string): FormFix => ({ kind: "link", to: TOOLS_PATH, label });
  if (rows.length === 0) {
    return [
      {
        part: "tools",
        mark: "ok",
        markWord: MARK_WORDS.ok,
        name: PART_NAMES.tools,
        detail: "no MCP servers yet",
        fix: manage("Add tools"),
      },
    ];
  }
  if (rows.every((each) => each.state === "ok")) {
    const count = `${rows.length} MCP server${rows.length === 1 ? "" : "s"}`;
    return [
      {
        part: "tools",
        mark: "ok",
        markWord: MARK_WORDS.ok,
        name: PART_NAMES.tools,
        detail: count,
        fix: manage("Manage"),
      },
    ];
  }
  // The servers that are fine fold away, as in the terminal's overview.
  return rows
    .filter((each) => each.state !== "ok")
    .map((each) => row(each, { detail: `${each.name} · ${each.detail}`, fix: manage("Manage") }));
}

/** The Service card, from the page's own row: it runs, and the command that keeps it so when it is not kept. */
function serviceRow(service: SetupRow): FormRow {
  return row(service, { fix: service.state === "ok" ? null : { kind: "command", text: KEEP_SERVICE_COMMAND } });
}

/**
 * The cards of the form, in the design's order, whatever order the checks ran in. `service` is
 * the page's own Service row (`pageServiceRow`), which takes the place of the daemon's launchd
 * one; without it the daemon's row is shown. The socket and the config show only when something
 * is wrong with them, and healthy tool servers fold into one card.
 */
export function setupFormRows(rows: readonly SetupRow[], service?: SetupRow): FormRow[] {
  const daemonService = rows.find((each) => each.part === "service" && each.name === "service");
  const own = service ?? daemonService;
  const cards: FormRow[] = own === undefined ? [] : [serviceRow(own)];
  const ordered = [...rows].sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  const tools = ordered.filter((each) => each.part === "tools");
  for (const source of ordered) {
    if (source.part === "service") continue;
    if (source.part === "tools") continue;
    if ((source.part === "socket" || source.part === "config") && source.state === "ok") continue;
    switch (source.part) {
      case "engine":
        cards.push(engineRow(source));
        break;
      case "model":
        cards.push(modelRow(source));
        break;
      case "config":
        cards.push(configRow(source));
        break;
      default:
        cards.push(row(source));
    }
  }
  const at = cards.findIndex((card) => PART_ORDER.indexOf(card.part) > PART_ORDER.indexOf("tools"));
  const folded = toolRows(tools);
  cards.splice(at < 0 ? cards.length : at, 0, ...folded);
  return cards;
}
