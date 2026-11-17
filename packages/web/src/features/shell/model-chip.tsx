import { AUTO_MODEL_HINT, sessionModelOf, shownModel, shownModelText, type ShownModel } from "@golem/view";
import type { RefObject } from "react";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { useConfig, useModelList, useSession } from "../../store/page-context.tsx";
import type { SessionModel, SessionView } from "../../store/session-store.ts";
import { openModelDialog } from "../models/index.ts";

/**
 * The model of a chat. On `auto` it says `auto · llama3.2:3b`, the model golem picks, and choosing
 * one pins the chat.
 */
export function ModelChipView({
  shown,
  title,
  onOpen,
  buttonRef,
}: {
  shown: ShownModel;
  /** The profile and provider, shown when the model is not a pick. */
  title: string;
  onOpen: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const text = shownModelText(shown);
  return (
    <button
      ref={buttonRef}
      type="button"
      title={shown.pick ? AUTO_MODEL_HINT : title}
      aria-label={`Model: ${text}`}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(badgeVariants(), "cursor-pointer outline-offset-2 outline-clay hover:border-ink hover:text-ink focus-visible:outline-2")}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", shown.pick ? "bg-clay" : "bg-allow")} />
      {text}
    </button>
  );
}

const selectMode = ({ chat }: SessionView) => chat.route.mode;
const selectLast = ({ chat }: SessionView) => chat.route.last;
const selectCwd = (view: SessionView) => view.cwd;

/** The session's model. It opens the dialog that switches it. */
export function ModelChip({
  sessionId,
  model,
  buttonRef,
}: {
  sessionId: string;
  model: SessionModel;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const mode = useSession(sessionId, selectMode);
  const last = useSession(sessionId, selectLast);
  const cwd = useSession(sessionId, selectCwd);
  const models = useModelList(mode === "auto");
  const config = useConfig(cwd, sessionId, mode === "auto");
  const session = sessionModelOf(model, models.data?.models);
  const shown = shownModel({ mode, session, last, models: models.data?.models, routing: config.data?.routing });
  const title = [model.profile, model.provider].filter((part) => part !== null).join(" · ");
  return <ModelChipView shown={shown} title={title} onOpen={() => openModelDialog({ sessionId, returnTo: "chip" })} buttonRef={buttonRef} />;
}
