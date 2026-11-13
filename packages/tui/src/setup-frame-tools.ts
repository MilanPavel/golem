import {
  toolsFailureChoices,
  toolsFailures,
  toolsLines,
  toolsMoved,
  toolsResult,
  toolsRetry,
  toolsSetToken,
  toolsSkipRow,
  toolsStart,
  toolsTick,
  toolsToAdd,
  toolsTokenCancelled,
  TOOLS_SKIP,
  type SetupLine,
  type SetupResult,
  type ToolsRow,
  type ToolsRuntime,
  type ToolsState,
} from "@golem/view";

import type { Press } from "./keys.ts";

/**
 * The Tools panel in the terminal's setup window (H1 to H6): the keys it takes, what each does
 * to the panel's state, and the lines it draws. The model in `@golem/view` holds the rows and
 * their progress. The work (`runtime.install`, `mcp.add`, `mcp.logs`) is the screen's, named by
 * the act a key press returns.
 */
export type ToolsUi = {
  /** Null until the catalog has been read. */
  state: ToolsState | null;
  /** Why the catalog could not be read. */
  error: string | null;
  /** The token as typed. Only its length is ever drawn, and it is cleared when it is handed on. */
  typed: string;
  /** The failed row whose new token is being typed. */
  retry: string | null;
  /** The selection among a failed row's choices. */
  choice: number;
  /** A server's log, shown in place of the panel. */
  log: { title: string; lines: readonly string[] } | null;
  /** The servers this panel saved, by name: the ones it may take out again. */
  created: readonly string[];
};

export function newToolsUi(): ToolsUi {
  return { state: null, error: null, typed: "", retry: null, choice: 0, log: null, created: [] };
}

export type ToolsKey =
  | { kind: "up" | "down" | "enter" | "back" | "space" | "skip" | "quit" | "interrupt" | "delete" | "clear" }
  | { kind: "text"; text: string };

/** The panel's keys. While a token is typed, letters are the token's, and q and s are not keys. */
export function toolsKeyOf(press: Press, typing: boolean): ToolsKey | null {
  switch (press.name) {
    case "escape":
      return { kind: "back" };
    case "return":
      return { kind: "enter" };
    case "ctrl-c":
      return { kind: "interrupt" };
    case "up":
      return typing ? null : { kind: "up" };
    case "down":
      return typing ? null : { kind: "down" };
    case "backspace":
      return typing ? { kind: "delete" } : null;
    case "ctrl-u":
    case "ctrl-w":
      return typing ? { kind: "clear" } : null;
    default:
      break;
  }
  if ((press.name !== null && press.name !== "question") || press.ctrl || press.meta || press.input.length === 0) {
    return null;
  }
  if (typing) {
    return { kind: "text", text: press.input };
  }
  switch (press.input) {
    case " ":
      return { kind: "space" };
    case "s":
      return { kind: "skip" };
    case "q":
      return { kind: "quit" };
    default:
      return null;
  }
}

/** What the screen does after a key. */
export type ToolsAct =
  | { kind: "none" }
  /** Run the next effect of the model: `toolsStep`. */
  | { kind: "step" }
  /** The window moves on with this result. */
  | { kind: "leave"; result: SetupResult }
  /** Stop installing this runtime, when one is being installed. */
  | { kind: "stop"; runtime: ToolsRuntime | null }
  /** Take a server this panel saved out of the config again. */
  | { kind: "remove"; name: string }
  | { kind: "logs"; id: string };

const NONE: ToolsAct = { kind: "none" };

/** Whether the token field is open, so that letters go into it. */
export function toolsTyping(ui: ToolsUi): boolean {
  return ui.state !== null && (ui.state.phase === "token" || ui.retry !== null);
}

function busy(row: ToolsRow): boolean {
  return row.status.kind === "waiting" || row.status.kind === "installing" || row.status.kind === "adding";
}

function typedInto(ui: ToolsUi, key: ToolsKey): ToolsUi {
  if (key.kind === "text") {
    return { ...ui, typed: ui.typed + key.text.replace(/[\r\n]/g, "") };
  }
  if (key.kind === "delete") {
    return { ...ui, typed: ui.typed.slice(0, -1) };
  }
  return key.kind === "clear" ? { ...ui, typed: "" } : ui;
}

function failedRow(state: ToolsState): ToolsRow | null {
  return toolsFailures(state)[0] ?? null;
}

export function pressTools(ui: ToolsUi, key: ToolsKey): { ui: ToolsUi; act: ToolsAct } {
  const stay = (next: ToolsUi, act: ToolsAct = NONE) => ({ ui: next, act });
  const state = ui.state;
  if (ui.log !== null) {
    return key.kind === "back" || key.kind === "enter" ? stay({ ...ui, log: null }) : stay(ui);
  }
  if (state === null) {
    if (key.kind === "back") {
      return stay(ui, { kind: "leave", result: { kind: "cancelled" } });
    }
    return key.kind === "enter" && ui.error !== null ? stay(ui, { kind: "leave", result: TOOLS_SKIP }) : stay(ui);
  }
  if (ui.retry !== null) {
    if (key.kind === "back") {
      return stay({ ...ui, retry: null, typed: "" });
    }
    if (key.kind === "enter") {
      const retried = toolsRetry(state, ui.retry, ui.typed);
      return stay({ ...ui, state: retried, retry: null, typed: "", choice: 0 }, { kind: "step" });
    }
    return stay(typedInto(ui, key));
  }
  if (state.phase === "token") {
    if (key.kind === "back") {
      return stay({ ...ui, state: toolsTokenCancelled(state), typed: "" });
    }
    if (key.kind === "enter") {
      const given = toolsSetToken(state, state.tokenFor ?? "", ui.typed);
      return stay({ ...ui, state: given, typed: "" });
    }
    return stay(typedInto(ui, key));
  }
  if (state.phase === "offer") {
    switch (key.kind) {
      case "up":
      case "down":
        return stay({ ...ui, state: toolsMoved(state, key.kind) });
      case "space": {
        const row = state.rows[state.selected];
        return row === undefined ? stay(ui) : stay({ ...ui, state: toolsTick(state, row.id), typed: "" });
      }
      case "enter": {
        const started = toolsStart(state);
        return started === null ? stay(ui) : stay({ ...ui, state: started }, { kind: "step" });
      }
      case "skip":
        return state.mode === "guided" ? stay(ui, { kind: "leave", result: TOOLS_SKIP }) : stay(ui);
      case "back":
        return stay(ui, { kind: "leave", result: { kind: "cancelled" } });
      default:
        return stay(ui);
    }
  }
  if (state.rows.some(busy)) {
    if (key.kind !== "back") {
      return stay(ui);
    }
    // Esc stops: what waits is dropped, and what is being added finishes on its own.
    const installing = state.rows.find((row) => row.status.kind === "installing");
    const runtime = installing?.status.kind === "installing" ? installing.status.runtime : null;
    const stopped: ToolsState = {
      ...state,
      rows: state.rows.map((row) =>
        row.status.kind === "waiting" || row.status.kind === "installing"
          ? { ...row, ticked: false, token: null, status: { kind: "skipped" } }
          : row,
      ),
    };
    return stay({ ...ui, state: stopped }, { kind: "stop", runtime });
  }
  const failed = failedRow(state);
  if (failed === null) {
    return key.kind === "enter" ? stay(ui, { kind: "leave", result: toolsResult(state) ?? { kind: "done" } }) : stay(ui);
  }
  const choices = toolsFailureChoices(failed);
  switch (key.kind) {
    case "up":
    case "down": {
      const next = Math.min(Math.max(ui.choice + (key.kind === "up" ? -1 : 1), 0), choices.length - 1);
      return stay({ ...ui, choice: next });
    }
    case "back":
      return stay(ui, { kind: "leave", result: { kind: "cancelled" } });
    case "enter":
      break;
    default:
      return stay(ui);
  }
  switch (choices[ui.choice]?.id) {
    case "token":
      return stay({ ...ui, retry: failed.id, typed: "" });
    case "retry":
      return stay({ ...ui, state: toolsRetry(state, failed.id, null), choice: 0 }, { kind: "step" });
    case "skip": {
      const skipped = { ...ui, state: toolsSkipRow(state, failed.id), choice: 0 };
      return ui.created.includes(failed.name)
        ? stay({ ...skipped, created: ui.created.filter((name) => name !== failed.name) }, { kind: "remove", name: failed.name })
        : stay(skipped);
    }
    case "log":
      return stay(ui, { kind: "logs", id: failed.id });
    default:
      return stay(ui);
  }
}

/** The screens the hints are for. */
export type ToolsScreen =
  | "tools-loading"
  | "tools-error"
  | "tools-offer"
  | "tools-token"
  | "tools-adding"
  | "tools-added"
  | "tools-failed"
  | "tools-log";

const LOG_LINES = 12;
const MORE = "More servers: close this and type /mcp";

/** What the panel draws now, and how many servers Enter would add. */
export function toolsView(ui: ToolsUi): { lines: SetupLine[]; screen: ToolsScreen; adds: number } {
  const state = ui.state;
  if (ui.log !== null) {
    const shown = ui.log.lines.length === 0 ? ["nothing logged"] : ui.log.lines.slice(-LOG_LINES);
    return {
      lines: [{ kind: "title", text: ui.log.title }, { kind: "blank" }, ...shown.map((text): SetupLine => ({ kind: "text", text, dim: true }))],
      screen: "tools-log",
      adds: 0,
    };
  }
  if (state === null) {
    return ui.error === null
      ? { lines: [{ kind: "text", text: "Looking for tools…", dim: true }], screen: "tools-loading", adds: 0 }
      : {
          lines: [{ kind: "title", text: "Tools" }, { kind: "blank" }, { kind: "text", text: `Couldn't read the tools: ${ui.error}` }],
          screen: "tools-error",
          adds: 0,
        };
  }
  const typed = Math.min(ui.typed.length, 40);
  if (ui.retry !== null) {
    return { lines: toolsLines({ ...state, phase: "token", tokenFor: ui.retry }, typed), screen: "tools-token", adds: 0 };
  }
  if (state.phase === "token") {
    return { lines: toolsLines(state, typed), screen: "tools-token", adds: 0 };
  }
  const adds = toolsToAdd(state).length;
  if (state.phase === "offer") {
    const more: SetupLine[] = state.mode === "single" ? [{ kind: "blank" }, { kind: "text", text: MORE, dim: true }] : [];
    return { lines: [...toolsLines(state), ...more], screen: "tools-offer", adds };
  }
  const rows = toolsLines(state);
  const failed = failedRow(state);
  if (state.rows.some(busy)) {
    const count = state.rows.filter((row) => row.status.kind !== "idle").length;
    const title: SetupLine = { kind: "title", text: `Adding ${count} tool${count === 1 ? "" : "s"}` };
    return { lines: [title, { kind: "blank" }, ...rows], screen: "tools-adding", adds };
  }
  if (failed !== null) {
    const choices = toolsFailureChoices(failed).map(
      (choice, index): SetupLine => ({ kind: "option", label: choice.label, detail: "", selected: index === ui.choice }),
    );
    return { lines: [...rows, { kind: "blank" }, ...choices], screen: "tools-failed", adds };
  }
  const footer: SetupLine[] = [
    { kind: "blank" },
    { kind: "text", text: "On in every chat. Turn one off, or make it", dim: true },
    { kind: "text", text: "on demand, with /mcp any time.", dim: true },
  ];
  return { lines: [...rows, ...footer], screen: "tools-added", adds };
}

/** The key hint of a Tools screen. `adds` is how many servers Enter would add, and `guided` allows skipping. */
export function toolsHint(screen: ToolsScreen, adds: number, guided: boolean): string {
  switch (screen) {
    case "tools-loading":
      return "";
    case "tools-error":
      return "Enter continues · Esc back";
    case "tools-offer":
      return [
        "Space ticks",
        ...(adds > 0 ? [`Enter adds ${adds}`] : []),
        ...(guided ? ["s skip"] : []),
        "Esc back",
      ].join(" · ");
    case "tools-token":
      return "Enter keeps it · Esc back";
    case "tools-adding":
      return "Esc stops";
    case "tools-added":
      return "Enter continues";
    case "tools-failed":
      return "Enter picks · ↑↓ move · Esc back";
    case "tools-log":
      return "Esc back";
  }
}

/** What Ready says about tools, or null when none ran and none exist (A9). */
export function toolsReadyText(ran: readonly string[], existing: readonly string[]): string | null {
  if (ran.length > 0) {
    return `${ran.join(", ")} · on in every chat`;
  }
  return existing.length > 0 ? existing.join(", ") : null;
}

/** The titles of the servers a run added, for Ready. */
export function toolsRan(state: ToolsState | null): string[] {
  return state === null ? [] : state.rows.filter((row) => !row.already && row.status.kind === "added").map((row) => row.title);
}
