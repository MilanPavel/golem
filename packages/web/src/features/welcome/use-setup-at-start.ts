import { pickerName, setupAtStart } from "@golem/view";
import { useEffect } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useModelList, useNavigate, usePageActions, useRoute, useSetupStart } from "../../store/page-context.tsx";
import { welcomePath } from "../../store/router.ts";
import { startNoticeStore } from "../setup/index.ts";

/**
 * What the start does, once per page load: when connected and the model list is in, the
 * terminal's own rules decide. Guided setup opens `/welcome`, a default that is gone opens
 * `/welcome?step=model`, one ready model with no default becomes the default and leaves a
 * notice, and a setup that works changes nothing. On `/welcome` already, nothing moves.
 */
export function useSetupAtStart(): void {
  const connected = useConnection().state.status === "connected";
  const listing = useModelList(connected).data;
  const gate = useSetupStart();
  const actions = usePageActions();
  const navigate = useNavigate();
  const onWelcome = useRoute().name === "welcome";

  useEffect(() => {
    if (!connected || listing === undefined || gate.decided()) return;
    gate.decide();
    const start = setupAtStart(true, listing);
    if (start?.kind === "auto") {
      // No default and one model ready: it is the default, as in the terminal, and nothing opens.
      const model = start.model;
      actions.setDefault(pickerName(model)).then(
        () => {
          startNoticeStore.set(`Using ${model.ref}, the only model ready. /setup to change.`);
        },
        () => undefined,
      );
      return;
    }
    if (start?.kind !== "window" || start.window.view !== "panel") return;
    // Already on the page, at whatever step the address names: stay.
    if (onWelcome) return;
    // Replace, so Back from the page does not return to a home that sends it here again.
    navigate(welcomePath(start.window.mode === "guided" ? "engine" : "model"), { replace: true });
  }, [connected, listing, gate, actions, navigate, onWelcome]);
}

/** Mounts the start rule once for the shell. It draws nothing. */
export function SetupAtStart(): null {
  useSetupAtStart();
  return null;
}
