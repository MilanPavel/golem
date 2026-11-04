import { pickerName, setupAtStart, type SetupWindow } from "@golem/view";
import { useEffect } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useModelList, usePageActions, useSetupStart } from "../../store/page-context.tsx";
import { activeComposer } from "../composer/index.ts";
import { closeSetup, openSetup, setupStore, useSetupOpen } from "./setup-open.ts";
import { SetupDialogView } from "./setup-dialog.tsx";
import { startNoticeStore } from "./start-notice.ts";
import { useSetup } from "./use-setup.ts";

function ConnectedSetup({ start, returnTo }: { start: SetupWindow; returnTo: HTMLElement | null }) {
  const setup = useSetup(start, closeSetup);
  return (
    <SetupDialogView
      open
      onClose={closeSetup}
      onCloseAutoFocus={(event) => {
        // Focus goes back to what had it when the window opened, or to the composer.
        event.preventDefault();
        (returnTo?.isConnected === true ? returnTo : activeComposer())?.focus();
      }}
      window={setup.ui.window}
      view={setup.view}
      pull={setup.pull}
      onKey={setup.press}
      onChoose={setup.choose}
    />
  );
}

const hasDialog = (): boolean => document.querySelector("[role=dialog]") !== null;

/** Runs `open` once no dialog is open: now, or as soon as the last one goes. */
function whenNoDialog(open: () => void): void {
  if (!hasDialog()) {
    open();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!hasDialog()) {
      observer.disconnect();
      open();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * What opens at the start, once per page load: when connected and the model list is in, the
 * terminal's own rules decide between guided setup, the Model panel alone, or nothing.
 */
function useSetupAtStart(): void {
  const connected = useConnection().state.status === "connected";
  const listing = useModelList(connected).data;
  const gate = useSetupStart();
  const actions = usePageActions();

  useEffect(() => {
    if (!connected || listing === undefined || gate.decided()) return;
    gate.decide();
    const start = setupAtStart(true, listing);
    if (start?.kind === "auto") {
      // No default and one model ready: it is the default, as in the terminal, and no window opens.
      const model = start.model;
      actions.setDefault(pickerName(model)).then(
        () => {
          startNoticeStore.set(`Using ${model.ref}, the only model ready. /setup to change.`);
        },
        () => undefined,
      );
      return;
    }
    if (start?.kind !== "window") return;
    const window = start.window;
    // The wait outlives this effect on purpose: a strict-mode remount runs it twice, and the
    // decision is made only once.
    whenNoDialog(() => {
      if (setupStore.getSnapshot() === null) openSetup({ window });
    });
  }, [connected, listing, gate, actions]);
}

/** The setup window of the page, mounted once. It opens from `/setup`, the palette, a send with no model, and the start. */
export function SetupHost() {
  useSetupAtStart();
  const open = useSetupOpen();
  // The window stays open in the store while the shell is away (a reconnect shows the connection
  // screen in its place), so it is there again when the shell comes back.
  return open === null ? null : <ConnectedSetup key={open.id} start={open.window} returnTo={open.returnTo} />;
}
