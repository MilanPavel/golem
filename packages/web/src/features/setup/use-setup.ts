import {
  advance,
  appendInstallOutput,
  daemonServiceRow,
  keyMissing,
  modelPullFailed,
  move,
  OLLAMA_DOWNLOAD_URL,
  ollamaInstallEnded,
  overviewChoices,
  pageKeyChecked,
  pageServiceRow,
  pickerName,
  pressEngine,
  pressModel,
  pressOllama,
  pressPageKey,
  pressProvider,
  providerName,
  single,
  guided,
  type InstallTail,
  type PanelKey,
  type PanelWindow,
  type SetupNext,
  type SetupWindow,
} from "@golem/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useConnection } from "../../store/connection-context.tsx";
import type { ModelListResult } from "../../store/models.ts";
import type { PullEntry } from "../../store/pulls.ts";
import { useModelList, usePageActions, usePulls, useSetupStatus } from "../../store/page-context.tsx";
import { withActivePulls } from "../models/index.ts";
import { arrive, modelScopeOf, newSetupUi, panelView, type PanelView, type SetupUi } from "./setup-ui.ts";

const TICK_MS = 1000;
const WAIT_POLL_MS = 3000;

export type Setup = {
  ui: SetupUi;
  view: PanelView;
  /** The running download of the Model panel, from the pulls store. */
  pull: PullEntry | undefined;
  press: (key: PanelKey) => void;
  /** A click: move to the choice, then Enter, through the same reducer as the keys. */
  choose: (index: number) => void;
};

/**
 * The setup window's moves. Every key and click goes through the panel's reducer in
 * `@golem/view`, and every change of panel through `advance`, as in the terminal. `onClose`
 * runs when the table says the chat, or the window is closed.
 */
export function useSetup(start: SetupWindow, onClose: () => void): Setup {
  const actions = usePageActions();
  const connection = useConnection();
  const modelList = useModelList(true);
  const status = useSetupStatus(true);
  const pulls = usePulls();

  const listing = modelList.data ?? null;
  const listingRef = useRef<ModelListResult | null>(listing);
  listingRef.current = listing;

  const [ui, setUi] = useState<SetupUi>(() => arrive(start, newSetupUi(start, listing), listing, Date.now()).ui);
  const uiRef = useRef(ui);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  /** Downloads the daemon took, or that showed progress: only these end the panel when they leave the pulls store. */
  const live = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((next: SetupUi): void => {
    uiRef.current = next;
    if (mounted.current) setUi(next);
  }, []);
  const update = useCallback(
    (change: (ui: SetupUi) => SetupUi): void => {
      show(change(uiRef.current));
    },
    [show],
  );

  const facts = (): { ollamaRunning: boolean } => ({ ollamaRunning: listingRef.current?.setup.ollama_running === true });
  const panelOf = (window: SetupWindow): PanelWindow | null => (window.view === "panel" ? window : null);

  function refreshListing(): Promise<ModelListResult> {
    return actions.refreshModels().then((listed) => {
      listingRef.current = listed;
      return listed;
    });
  }

  /** Start Ollama, list the models again, and go on from the Ollama panel. */
  function startOllamaNow(): void {
    update((current) => ({
      ...current,
      ollama: { phase: "starting", since: Date.now(), installed: current.ollama.phase === "starting" && current.ollama.installed },
    }));
    void actions
      .startOllama()
      .then(async (running) => {
        if (!running) throw new Error("Ollama didn't start");
        await refreshListing();
        const current = uiRef.current;
        const window = panelOf(current.window);
        if (mounted.current && window?.panel === "ollama") go(advance(window, { kind: "done" }, { ollamaRunning: true }), current);
      })
      .catch((error: unknown) => {
        update((current) => ({ ...current, ollama: { phase: "failed", reason: actionErrorText(error, "Ollama didn't start"), selected: 0 } }));
      });
  }

  function openDownloadPage(): void {
    try {
      window.open(OLLAMA_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    } catch {
      // The panel shows the link as well.
    }
  }

  /** The daemon installs Ollama with Homebrew; its output reaches every window. */
  function installOllama(): void {
    let tail: InstallTail = { last: "", partial: "" };
    actions
      .installOllama((event) => {
        if (event.kind === "output") {
          tail = appendInstallOutput(tail, event.text);
          const last = tail.last;
          update((current) => (current.ollama.phase === "installing" ? { ...current, ollama: { ...current.ollama, last } } : current));
          return;
        }
        const outcome = event.kind === "error" ? "failed" : event.stopped ? "stopped" : event.code === 0 ? "installed" : "failed";
        const reason = event.kind === "error" ? event.message : tail.last.length > 0 ? tail.last : "brew install ollama failed";
        update((current) => ({ ...current, ollama: ollamaInstallEnded(current.ollama, outcome, reason, Date.now()) }));
        if (outcome === "installed" && mounted.current) startOllamaNow();
      })
      .then(
        (result) => {
          if (result === "no_brew") {
            update((current) => ({ ...current, ollama: ollamaInstallEnded(current.ollama, "no_brew", "", Date.now()) }));
            openDownloadPage();
          }
        },
        (error: unknown) => {
          update((current) => ({ ...current, ollama: ollamaInstallEnded(current.ollama, "failed", actionErrorText(error, "brew install ollama failed"), Date.now()) }));
        },
      );
  }

  /** Go where the navigation table says. */
  function go(next: SetupNext, from: SetupUi): void {
    if (next.kind === "quit" || next.kind === "chat") {
      closeRef.current();
      return;
    }
    const arrived = arrive(next.window, from, listingRef.current, Date.now());
    if (arrived.ollama === "running") {
      const window = panelOf(next.window);
      if (window !== null) go(advance(window, { kind: "done" }, facts()), arrived.ui);
      return;
    }
    show(arrived.ui);
    const window = panelOf(next.window);
    if (window?.panel === "ollama" && arrived.ui.ollama.phase === "starting") startOllamaNow();
    if (next.window.view === "overview") void status.refetch();
  }

  // The Ollama panel opened on a stopped Ollama starts it.
  useEffect(() => {
    const window = panelOf(uiRef.current.window);
    if (window?.panel === "ollama" && uiRef.current.ollama.phase === "starting") startOllamaNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock for the seconds, while something waits.
  const ticking =
    (ui.window.view === "panel" && ui.window.panel === "ollama" && ["installing", "starting", "waiting"].includes(ui.ollama.phase)) ||
    (ui.window.view === "panel" && ui.window.panel === "model" && ui.model.phase === "downloading");
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);

  // From the download page, setup goes on by itself once Ollama is on this Mac.
  const waiting = ui.window.view === "panel" && ui.window.panel === "ollama" && ui.ollama.phase === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void refreshListing().then(
        (listed) => {
          if (listed.setup.ollama_installed && uiRef.current.ollama.phase === "waiting" && mounted.current) startOllamaNow();
        },
        () => undefined,
      );
    }, WAIT_POLL_MS);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  // A download the panel waits for: progress marks it live, and its end moves the panel on.
  const downloading = ui.model.phase === "downloading" ? ui.model.ref : null;
  const entry = downloading === null ? undefined : pulls.active.get(downloading);
  const failed = downloading === null ? undefined : pulls.failed.get(downloading);
  if (downloading !== null && entry !== undefined && entry.status !== "starting") live.current.add(downloading);
  useEffect(() => {
    if (downloading === null || entry !== undefined || !live.current.has(downloading)) return;
    live.current.delete(downloading);
    if (failed !== undefined) {
      update((current) => ({ ...current, model: modelPullFailed(current.model, failed) }));
      return;
    }
    const ref = downloading;
    void refreshListing().then(
      (listed) => {
        const model = listed.models.find((each) => each.ref === ref);
        if (model === undefined) throw new Error(`${ref} is not listed`);
        return pick(model);
      },
      (error: unknown) => {
        update((current) => ({ ...current, model: modelPullFailed(current.model, actionErrorText(error, "Could not list the models")) }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloading, entry, failed]);

  /** A model was chosen: it becomes the default, then Ready in guided mode, else back where the panel came from. */
  async function pick(model: ModelListResult["models"][number]): Promise<void> {
    const name = pickerName(model);
    try {
      await actions.setDefault(name);
    } catch (error) {
      update((current) => ({
        ...current,
        model: { phase: "failed", ref: model.ref, reason: actionErrorText(error, "Could not make it the default."), selected: 0, all: false },
      }));
      return;
    }
    const current = uiRef.current;
    const window = panelOf(current.window);
    if (!mounted.current || window === null) return;
    const engine = model.provider === "ollama" ? "Ollama on this Mac" : `${providerName(model.provider)} with an API key`;
    const ready = { engine, model: `${model.label} · saved as default` };
    const overview = { ...current.overview, notice: `default is now ${model.label}` };
    go(advance({ ...window, panel: "model" }, { kind: "done" }, facts()), { ...current, ready, overview });
  }

  const service = useMemo(
    () => pageServiceRow(daemonServiceRow(status.data?.rows ?? []), connection.daemonVersion ?? ""),
    [status.data, connection.daemonVersion],
  );
  const rows = useMemo(() => (status.isError ? [] : (status.data?.rows ?? null)), [status.isError, status.data]);

  const view = useMemo(
    () => panelView(ui, { listing, rows, service, pulls, now }),
    [ui, listing, rows, service, pulls, now],
  );
  const pull = entry;

  /** The window's own keys: the same on a click and on the keyboard. */
  function press(key: PanelKey): void {
    const current = uiRef.current;
    const window = current.window;
    if (window.view === "overview") {
      pressOverview(current, key);
      return;
    }
    switch (window.panel) {
      case "service":
        if (key === "enter") go(advance(window, { kind: "done" }, facts()), current);
        else if (key === "back") go(advance(window, { kind: "cancelled" }, facts()), current);
        return;
      case "engine": {
        if (key === "back") {
          go(advance(window, { kind: "cancelled" }, facts()), current);
          return;
        }
        const pressed = pressEngine(window.origin, listingRef.current, current.engine, key);
        if (pressed.result === null) {
          show({ ...current, engine: pressed.selected });
          return;
        }
        const path = pressed.result.kind === "key" ? "key" : "local";
        go(advance(window, pressed.result, facts()), { ...current, engine: pressed.selected, path });
        return;
      }
      case "ollama": {
        const pressed = pressOllama(current.ollama, key, Date.now());
        show({ ...current, ollama: pressed.state });
        switch (pressed.effect.kind) {
          case "install":
            installOllama();
            break;
          case "website":
            openDownloadPage();
            break;
          case "cancel":
            void actions.cancelOllamaInstall().catch(() => undefined);
            break;
          case "back":
            go(advance(window, { kind: "cancelled" }, facts()), current);
            break;
          case "none":
            break;
        }
        return;
      }
      case "provider": {
        if (key === "back") {
          go(advance(window, { kind: "cancelled" }, facts()), current);
          return;
        }
        const pressed = pressProvider(listingRef.current, current.provider, key);
        if (pressed.provider === null) {
          show({ ...current, provider: pressed.selected });
          return;
        }
        go(advance(window, { kind: "provider", provider: pressed.provider }, facts()), {
          ...current,
          provider: pressed.selected,
          hosted: pressed.provider,
          path: "key",
        });
        return;
      }
      case "key": {
        const pressed = pressPageKey(current.key, key);
        show({ ...current, key: pressed.state });
        if (pressed.effect.kind === "back") go(advance(window, { kind: "cancelled" }, facts()), current);
        else if (pressed.effect.kind === "done") go(advance(window, { kind: "done" }, facts()), current);
        else if (pressed.effect.kind === "check") checkKey(window, current);
        return;
      }
      case "model":
        pressModelPanel(window, current, key);
        return;
      case "ready":
        if (key === "enter" || key === "back") closeRef.current();
        return;
    }
  }

  function checkKey(window: PanelWindow, from: SetupUi): void {
    const provider = from.hosted ?? "anthropic";
    void refreshListing().then(
      (listed) => {
        const checked = pageKeyChecked(keyMissing(listed, provider));
        const current = uiRef.current;
        if (!mounted.current || current.window.view !== "panel" || current.window.panel !== "key") return;
        if (checked === "done") go(advance(window, { kind: "done" }, facts()), { ...current, key: { phase: "ask" } });
        else show({ ...current, key: checked });
      },
      () => {
        update((current) => ({ ...current, key: { phase: "absent" } }));
      },
    );
  }

  function pressModelPanel(window: PanelWindow, current: SetupUi, key: PanelKey): void {
    const listed = withActivePulls(listingRef.current, pulls);
    const pressed = pressModel(listed, modelScopeOf(current, window, listingRef.current), current.model, key, Date.now());
    show({ ...current, model: pressed.state });
    const effect = pressed.effect;
    switch (effect.kind) {
      case "choose":
        void pick(effect.model);
        break;
      case "pull": {
        const ref = effect.model.ref;
        void actions.pull(ref).then(
          () => {
            live.current.add(ref);
          },
          (error: unknown) => {
            live.current.delete(ref);
            update((now2) => ({ ...now2, model: modelPullFailed(now2.model, actionErrorText(error, "Could not start the download.")) }));
          },
        );
        break;
      }
      case "background":
        // The model becomes the default when the download ends, with this window closed.
        if (current.model.phase === "downloading") {
          const ref = current.model.ref;
          const named = listingRef.current?.models.find((each) => each.ref === ref);
          actions.defaultWhenPulled(ref, named === undefined ? ref : pickerName(named));
        }
        go(advance({ ...window, panel: "model" }, { kind: "background" }, facts()), current);
        break;
      case "back":
        go(advance(window, { kind: "cancelled" }, facts()), current);
        break;
      case "none":
        break;
    }
  }

  function pressOverview(current: SetupUi, key: PanelKey): void {
    if (key === "back") {
      closeRef.current();
      return;
    }
    if (rows === null) return;
    const choices = overviewChoices(rows, service);
    if (key === "up" || key === "down") {
      show({ ...current, overview: { ...current.overview, selected: move(current.overview.selected, choices.length, key) } });
      return;
    }
    const choice = choices[current.overview.selected];
    if (choice === undefined) return;
    if (choice.kind === "guided") {
      go({ kind: "window", window: guided("service", "overview") }, current);
      return;
    }
    if (choice.kind === "service") {
      go({ kind: "window", window: single("service", "overview") }, current);
      return;
    }
    switch (choice.action) {
      case "start_ollama":
        show({ ...current, overview: { ...current.overview, notice: "starting Ollama…" } });
        void actions.startOllama().then(
          (running) => {
            update((now2) => ({ ...now2, overview: { ...now2.overview, notice: running ? "Ollama is running" : "Ollama didn't start" } }));
          },
          (error: unknown) => {
            update((now2) => ({ ...now2, overview: { ...now2.overview, notice: `Ollama didn't start: ${actionErrorText(error, "no answer")}` } }));
          },
        );
        return;
      case "install_ollama":
        go({ kind: "window", window: single("ollama", "overview") }, { ...current, path: "local" });
        return;
      case "pick_model":
        go({ kind: "window", window: single("model", "overview") }, { ...current, path: "pick" });
        return;
      case "set_key":
        go(
          { kind: "window", window: single(choice.target === null ? "provider" : "key", "overview") },
          { ...current, hosted: choice.target, path: "key" },
        );
        return;
      case "edit_config":
        return;
    }
  }

  const choose = (index: number): void => {
    // The selection is the panel's own; a click walks it to the choice, then presses Enter.
    const selectedAt = selectedOf(uiRef.current, view);
    for (let step = selectedAt; step !== index; step += index > step ? 1 : -1) {
      press(index > step ? "down" : "up");
    }
    press("enter");
  };

  return { ui, view, pull, press, choose };
}

/** The selected choice's index in the panel's list, from the panel's own state. */
function selectedOf(ui: SetupUi, view: PanelView): number {
  const at = view.lines.filter((line) => line.kind === "option").findIndex((line) => line.selected);
  return view.offset + Math.max(0, at);
}
