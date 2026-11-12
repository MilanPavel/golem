import type { SetupWindow } from "@golem/view";
import { activeComposer } from "../composer/index.ts";
import { closeSetup, useSetupOpen } from "./setup-open.ts";
import { SetupDialogView } from "./setup-dialog.tsx";
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

/** The setup window of the page, mounted once. It opens from `/setup`, the palette, and a send with no model. The start opens the welcome page instead. */
export function SetupHost() {
  const open = useSetupOpen();
  // The window stays open in the store while the shell is away (a reconnect shows the connection
  // screen in its place), so it is there again when the shell comes back.
  return open === null ? null : <ConnectedSetup key={open.id} start={open.window} returnTo={open.returnTo} />;
}
