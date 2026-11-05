import {
  ASK_PAGE_KEY,
  defaultGone,
  keyMissing,
  openPageKey,
  engineLines,
  engineSelected,
  firstShown,
  KEEP_SERVICE_COMMAND,
  modelChoices,
  modelLines,
  modelSelected,
  OLLAMA_DOWNLOAD_URL,
  ollamaAtOpen,
  ollamaLines,
  overviewLines,
  pageKeyCommand,
  pageKeyLines,
  pageServiceLines,
  providerLines,
  providerSelected,
  readyLines,
  START_MODEL_PANEL,
  type ModelPanelState,
  type ModelScope,
  type OllamaState,
  type PageKeyState,
  type PanelWindow,
  type SetupLine,
  type SetupWindow,
} from "@golem/view";
import type { ModelListResult, SetupRow } from "../../store/models.ts";
import { withActivePulls } from "../models/index.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";

/**
 * The setup window as the page holds it: where it is, and each panel's own state. The panels'
 * lines, choices, and reducers come from `@golem/view`, as in the terminal.
 */
export type SetupUi = {
  window: SetupWindow;
  engine: number;
  /** Which picker the Engine, the overview, or the start asked for. */
  path: "local" | "key" | "pick";
  overview: { selected: number; notice: string | null };
  ollama: OllamaState;
  model: ModelPanelState;
  /** The Provider panel's selection, and the provider the Key panel is for. */
  provider: number;
  hosted: string | null;
  key: PageKeyState;
  ready: { engine: string; model: string } | null;
};

export function newSetupUi(window: SetupWindow, listing: ModelListResult | null): SetupUi {
  return {
    window,
    engine: engineSelected(listing),
    path: "pick",
    overview: { selected: 0, notice: null },
    ollama: { phase: "missing", selected: 0, note: null },
    model: START_MODEL_PANEL,
    provider: 0,
    hosted: null,
    key: ASK_PAGE_KEY,
    ready: null,
  };
}

/** Which models the Model panel offers: this Mac's in guided mode, else every ready engine's. */
export function modelScopeOf(ui: SetupUi, window: PanelWindow, listing: ModelListResult | null): ModelScope {
  if (window.mode === "guided") {
    return ui.path === "key" && ui.hosted !== null ? { kind: "provider", provider: ui.hosted } : { kind: "local" };
  }
  if (window.origin === "start" && listing !== null && listing.default !== null && defaultGone(listing)) {
    return { kind: "gone", name: listing.default };
  }
  return { kind: "all", current: listing?.default ?? null };
}

/** The state for arriving at `window`, from `from`. Pure: the caller starts what a panel needs to run. */
export function arrive(
  window: SetupWindow,
  from: SetupUi,
  listing: ModelListResult | null,
  now: number,
): { ui: SetupUi; ollama: "running" | "open" } {
  const ui: SetupUi = { ...from, window };
  if (window.view === "overview") {
    return { ui: { ...ui, overview: { ...from.overview, selected: 0 } }, ollama: "open" };
  }
  switch (window.panel) {
    case "engine":
      ui.engine = engineSelected(listing);
      break;
    case "ollama": {
      const opened = ollamaAtOpen(listing, now);
      if (opened === "running") {
        return { ui, ollama: "running" };
      }
      ui.ollama = opened;
      break;
    }
    case "model": {
      const scope = modelScopeOf(ui, window, listing);
      ui.model = { phase: "pick", selected: listing === null ? 0 : modelSelected(modelChoices(listing, scope, false)), all: false };
      break;
    }
    case "provider":
      ui.provider = providerSelected(listing);
      break;
    case "key":
      ui.hosted = ui.hosted ?? "anthropic";
      ui.key = openPageKey(keyMissing(listing, ui.hosted));
      break;
    case "service":
    case "ready":
      break;
  }
  return { ui, ollama: "open" };
}

/** What a panel draws, as lines plus the few things a browser adds to them. */
export type PanelView = {
  lines: SetupLine[];
  /** A command to copy, drawn before the choices. */
  command: string | null;
  /** The index in the panel's choices of the first option line, for a list that scrolls. */
  offset: number;
  /** Options that are links to a page, by their index. */
  links: ReadonlyMap<number, string>;
  /** A link after the lines, for a panel that waits on a page the person opens. */
  waitLink: { label: string; href: string } | null;
  /** A running download, drawn as a bar under its first line. */
  download: { ref: string; label: string } | null;
  hint: string;
  /** Changes when the panel or its phase does, so focus moves to the new choices. */
  id: string;
};

export type PanelContext = {
  listing: ModelListResult | null;
  /** The overview rows from `setup.status`, or null while they load. */
  rows: readonly SetupRow[] | null;
  service: SetupRow;
  pulls: PullsSnapshot;
  now: number;
};

const NO_LINKS: ReadonlyMap<number, string> = new Map();
const PICKS = "Enter picks · ↑↓ move · Esc back";

function view(id: string, lines: SetupLine[], hint: string, extra: Partial<PanelView> = {}): PanelView {
  return { lines, command: null, offset: 0, links: NO_LINKS, waitLink: null, download: null, hint, id, ...extra };
}

export function panelView(ui: SetupUi, ctx: PanelContext): PanelView {
  const { listing, rows, service, now } = ctx;
  const window = ui.window;
  if (window.view === "overview") {
    return view("overview", overviewLines(rows, service, ui.overview.selected, ui.overview.notice), "Enter picks · ↑↓ move · Esc closes");
  }
  switch (window.panel) {
    case "service": {
      const kept = service.state === "ok";
      const lines =
        rows === null
          ? ([
              { kind: "status", mark: "ok", text: "service running" },
              { kind: "text", text: "checking whether it starts at login…", dim: true },
              { kind: "blank" },
              { kind: "option", label: "Continue", detail: "", selected: true },
            ] satisfies SetupLine[])
          : pageServiceLines(service);
      const hint = window.mode === "guided" && window.origin === "start" ? "Enter continues · Esc closes" : "Enter continues · Esc back";
      return view("service", lines, hint, { command: rows === null || kept ? null : KEEP_SERVICE_COMMAND });
    }
    case "engine":
      return view("engine", engineLines(window.origin, listing, ui.engine), PICKS);
    case "ollama": {
      const state = ui.ollama;
      const lines = ollamaLines(state, now);
      const hint = state.phase === "installing" ? "Esc stops" : state.phase === "missing" || state.phase === "failed" ? PICKS : "Esc back";
      const links = state.phase === "missing" || state.phase === "failed" ? new Map([[1, OLLAMA_DOWNLOAD_URL]]) : NO_LINKS;
      const waitLink = state.phase === "waiting" ? { label: "Open ollama.com/download", href: OLLAMA_DOWNLOAD_URL } : null;
      return view(`ollama:${state.phase}`, lines, hint, { links, waitLink });
    }
    case "provider":
      return view("provider", providerLines(listing, ui.provider), PICKS);
    case "key": {
      const provider = ui.hosted ?? "anthropic";
      const saved = ui.key.phase === "saved";
      return view(`key:${ui.key.phase}`, pageKeyLines(provider, ui.key), saved ? "Enter continues · Esc back" : "Enter checks again · Esc back", {
        command: ui.key.phase === "checking" || saved ? null : pageKeyCommand(provider),
      });
    }
    case "model": {
      const shown = withActivePulls(listing, ctx.pulls);
      const scope = modelScopeOf(ui, window, listing);
      const state = ui.model;
      if (state.phase === "downloading") {
        const first = modelLines(shown, scope, state, now)[0];
        return view("model:downloading", first === undefined ? [] : [first], "Esc keeps it downloading and closes", {
          download: { ref: state.ref, label: state.label },
        });
      }
      const count = shown === null ? 0 : modelChoices(shown, scope, state.all).length;
      return view(`model:${state.phase}`, modelLines(shown, scope, state, now), PICKS, {
        offset: shown === null ? 0 : firstShown(state.selected, count),
      });
    }
    case "ready": {
      const summary = ui.ready ?? { engine: "", model: "" };
      const keptText = service.state === "ok" ? "running, starts at login" : "running";
      return view("ready", [...readyLines({ service: keptText, ...summary }), { kind: "blank" }, { kind: "option", label: "Start chatting", detail: "", selected: true }], "Enter closes");
    }
  }
}
