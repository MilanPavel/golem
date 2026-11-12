import { appendInstallOutput, type InstallTail } from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ModelListResult } from "../../store/models.ts";
import type { PageActions } from "../../store/page.ts";
import { usePageActions } from "../../store/page-context.tsx";

/**
 * What setup does to the machine, apart from how a screen shows it. /welcome keeps its
 * own state and the Settings form keeps a card's state, and both go through these.
 */

/** How an Ollama install ended. `no_brew` means there is no Homebrew, so the person downloads it. */
export type InstallEnd = { outcome: "installed" | "failed" | "stopped" | "no_brew"; reason: string };

export type InstallHandlers = {
  /** New output: the text that came, and the tail of everything so far. */
  onOutput: (text: string, tail: InstallTail) => void;
  /** Once, when the install is over. */
  onEnd: (end: InstallEnd) => void;
};

/** Asks the daemon to install Ollama with Homebrew, and reports its output and its end. */
export function runOllamaInstall(actions: Pick<PageActions, "installOllama">, handlers: InstallHandlers): void {
  let tail: InstallTail = { last: "", partial: "" };
  actions
    .installOllama((event) => {
      if (event.kind === "output") {
        tail = appendInstallOutput(tail, event.text);
        handlers.onOutput(event.text, tail);
        return;
      }
      const outcome = event.kind === "error" ? "failed" : event.stopped ? "stopped" : event.code === 0 ? "installed" : "failed";
      const reason = event.kind === "error" ? event.message : tail.last.length > 0 ? tail.last : "brew install ollama failed";
      handlers.onEnd({ outcome, reason });
    })
    .then(
      (result) => {
        if (result === "no_brew") handlers.onEnd({ outcome: "no_brew", reason: "" });
      },
      (error: unknown) => {
        handlers.onEnd({ outcome: "failed", reason: actionErrorText(error, "brew install ollama failed") });
      },
    );
}

/** Starts Ollama and lists the models again. It rejects when Ollama does not come up. */
export async function startOllamaAndList(actions: Pick<PageActions, "startOllama" | "refreshModels">): Promise<ModelListResult> {
  const running = await actions.startOllama();
  if (!running) throw new Error("Ollama didn't start");
  return actions.refreshModels();
}

/** Looks at the machine again: the listing, which holds the keys and Ollama, and the setup rows. */
export async function checkSetupAgain(
  actions: Pick<PageActions, "refreshModels">,
  refetchStatus: () => Promise<unknown>,
): Promise<void> {
  await Promise.all([actions.refreshModels(), refetchStatus()]);
}

const MAX_OUTPUT = 20_000;

/** The install's output as lines: a `\r` redraws a line, as a download's progress does, so the newest wins. */
export function installLog(output: string): string {
  return output
    .split("\n")
    .map((line) => line.split("\r").at(-1) ?? "")
    .join("\n")
    .trimEnd();
}

export type RunningAction = "install" | "start" | "check";

export type SetupActionsState = {
  running: RunningAction | null;
  /** Everything the install printed, capped, kept after it ends. */
  output: string;
  /** There is no Homebrew: the person downloads Ollama themselves. */
  noBrew: boolean;
  /** Why the last action failed, and which one it was. */
  error: { action: RunningAction; text: string } | null;
  /** The card whose `Check again` was pressed, so its spinner and its error show there. */
  from: string | null;
};

const IDLE: SetupActionsState = { running: null, output: "", noBrew: false, error: null, from: null };

export type SetupActions = {
  state: SetupActionsState;
  install: () => void;
  cancelInstall: () => void;
  start: () => void;
  /** `from` names the card that asked, so the answer shows in it. */
  checkAgain: (from: string) => void;
};

/**
 * The Settings form's actions: install Ollama, with its output, start it, and look again. Each
 * one refreshes what the page reads, so the cards change by themselves. A failure is kept as a
 * line for the card, never thrown.
 */
export function useSetupActions(refetchStatus: () => Promise<unknown>): SetupActions {
  const actions = usePageActions();
  const [state, setState] = useState<SetupActionsState>(IDLE);
  const mounted = useRef(true);
  const refetch = useRef(refetchStatus);
  useEffect(() => {
    mounted.current = true;
    refetch.current = refetchStatus;
    return () => {
      mounted.current = false;
    };
  }, [refetchStatus]);

  const change = useCallback((update: (current: SetupActionsState) => SetupActionsState): void => {
    if (mounted.current) setState(update);
  }, []);

  const fail = useCallback(
    (action: RunningAction, error: unknown, fallback: string): void => {
      change((current) => ({ ...current, running: null, error: { action, text: actionErrorText(error, fallback) } }));
    },
    [change],
  );

  const start = useCallback((): void => {
    change((current) => ({ ...current, running: "start", error: null }));
    startOllamaAndList(actions).then(
      () => {
        change((current) => ({ ...current, running: null }));
      },
      (error: unknown) => {
        fail("start", error, "Ollama didn't start");
      },
    );
  }, [actions, change, fail]);

  const install = useCallback((): void => {
    change(() => ({ running: "install", output: "", noBrew: false, error: null, from: null }));
    runOllamaInstall(actions, {
      onOutput: (text) => {
        change((current) => ({ ...current, output: (current.output + text).slice(-MAX_OUTPUT) }));
      },
      onEnd: ({ outcome, reason }) => {
        if (outcome === "installed") {
          // Installed: the daemon has Ollama on disk, so start it, as the window does.
          change((current) => ({ ...current, running: "start" }));
          startOllamaAndList(actions).then(
            () => {
              change((current) => ({ ...current, running: null }));
            },
            (error: unknown) => {
              fail("start", error, "Ollama didn't start");
            },
          );
        } else if (outcome === "no_brew") {
          change((current) => ({ ...current, running: null, noBrew: true }));
        } else if (outcome === "stopped") {
          change((current) => ({ ...current, running: null }));
        } else {
          change((current) => ({ ...current, running: null, error: { action: "install", text: reason } }));
        }
      },
    });
  }, [actions, change, fail]);

  const cancelInstall = useCallback((): void => {
    actions.cancelOllamaInstall().catch((error: unknown) => {
      fail("install", error, "Could not stop the install");
    });
  }, [actions, fail]);

  const checkAgain = useCallback(
    (from: string): void => {
    change((current) => ({ ...current, running: "check", error: null, from }));
    checkSetupAgain(actions, () => refetch.current()).then(
      () => {
        change((current) => ({ ...current, running: null }));
      },
      (error: unknown) => {
        fail("check", error, "Could not check again");
      },
    );
    },
    [actions, change, fail],
  );

  return { state, install, cancelInstall, start, checkAgain };
}
