import { tuneChip, tuneState, withSaved, withSession, type TuneState } from "@golem/view";
import { useEffect, useMemo, useState } from "react";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { openModelDialog } from "../models/index.ts";

/** The options a session changed from the model's own: `temp 0.2 · top_p 0.9`. A button that opens the Tune view. */
export function TuneChipView({ text, onOpen }: { text: string; onOpen: (trigger: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title="Options changed from the model's own. Open Tune."
      aria-label={`Changed options: ${text}. Open Tune.`}
      aria-haspopup="dialog"
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(badgeVariants(), "cursor-pointer outline-offset-2 outline-clay hover:border-ink hover:text-ink focus-visible:outline-2")}
    >
      {text}
    </button>
  );
}

const selectModel = (view: { model: { provider: string | null; name: string | null } | null }) => view.model;
const selectOptions = (view: { chat: { options: Readonly<Record<string, number | string>> } }) => view.chat.options;

/**
 * The chip for a session: its changed options, from the same rules as the terminal's status line.
 * Nothing on a hosted model, and nothing while every value is the model's own.
 */
export function TuneChip({ sessionId }: { sessionId: string }) {
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

  // What any client saves for the model keeps the chip fresh.
  useEffect(
    () => actions.watchSavedOptions((saved, values) => setLoaded((open) => (open === null ? open : withSaved(open, saved, values)))),
    [actions],
  );

  const text = useMemo(
    () => (loaded === null || model === null ? "" : tuneChip(withSession(loaded, overrides), model.provider)),
    [loaded, overrides, model],
  );
  if (text === "" || name === null) return null;
  return <TuneChipView text={text} onOpen={(trigger) => openModelDialog({ sessionId, returnTo: trigger, initial: { tune: `ollama/${name}` } })} />;
}
