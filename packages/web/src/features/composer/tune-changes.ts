import { tuneChip, tuneState, withSaved, withSession, type TuneState } from "@golem/view";
import { useEffect, useMemo, useState } from "react";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { openModelDialog } from "../models/index.ts";

const selectModel = (view: { model: { provider: string | null; name: string | null } | null }) => view.model;
const selectOptions = (view: { chat: { options: Readonly<Record<string, number | string>> } }) => view.chat.options;

/**
 * The options a session changed from the model's own, from the same rules as the terminal's status
 * line: `temp 0.2 · top_p 0.9`. Null on a hosted model, and while every value is the model's own.
 * `open` opens the Tune view of the session's model.
 */
export function useTuneChanges(sessionId: string): { text: string; open: (trigger: HTMLElement) => void } | null {
  const model = useSession(sessionId, selectModel);
  const overrides = useSession(sessionId, selectOptions);
  const actions = usePageActions();
  const name = model?.provider === "ollama" ? model.name : null;
  const [loaded, setLoaded] = useState<TuneState | null>(null);

  useEffect(() => {
    if (name === null) return;
    let live = true;
    actions.modelOptions(name, sessionId).then(
      (result) => {
        if (live) setLoaded(tuneState(result));
      },
      () => {
        if (live) setLoaded(null);
      },
    );
    return () => {
      live = false;
    };
  }, [actions, name, sessionId]);

  // What any client saves for the model keeps the dot fresh.
  useEffect(
    () => actions.watchSavedOptions((saved, values) => setLoaded((open) => (open === null ? open : withSaved(open, saved, values)))),
    [actions],
  );

  const text = useMemo(
    () => (loaded === null || model === null ? "" : tuneChip(withSession(loaded, overrides), model.provider)),
    [loaded, overrides, model],
  );
  if (text === "" || name === null) return null;
  return { text, open: (trigger) => openModelDialog({ sessionId, returnTo: trigger, initial: { tune: `ollama/${name}` } }) };
}
