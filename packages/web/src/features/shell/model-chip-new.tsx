import { AUTO_MODEL_HINT, namesModel, sessionModelOf, shownModel, shownModelText } from "@golem/view";
import type { RoutingGetResult } from "../../store/routing.ts";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import type { ModelListResult } from "../../store/models.ts";
import { useModelList, useNewSessionModel, useRouting } from "../../store/page-context.tsx";
import { openModelDialog } from "../models/index.ts";

/** What the chip says: the pick, else the default with a tag, else a question. `loading` until the list is known. */
export type NewSessionModelLabel =
  | { kind: "loading" }
  | { kind: "pick"; text: string }
  | { kind: "default"; text: string }
  | { kind: "auto"; text: string }
  | { kind: "none" };

/**
 * The pick's label (its ref if the list has no such model), else, when the new chat starts on `auto`,
 * the model auto starts on, else the default's label, else none.
 */
export function newSessionModelLabel(
  listing: ModelListResult | null,
  pick: string | null,
  routing: RoutingGetResult | null = null,
): NewSessionModelLabel {
  if (pick !== null) {
    const model = listing?.models.find((item) => namesModel(item, pick));
    return { kind: "pick", text: model?.label ?? pick };
  }
  if (listing === null) {
    return { kind: "loading" };
  }
  if (listing.default === null || listing.default === undefined) {
    return { kind: "none" };
  }
  const name = listing.default;
  if (routing?.routing.mode === "auto") {
    const session = sessionModelOf({ profile: name, provider: null, name: null }, listing.models);
    const shown = shownModel({ mode: "auto", session, last: null, models: listing.models, routing: { ladder: routing.ladder } });
    if (shown.pick) return { kind: "auto", text: shownModelText(shown) };
  }
  return { kind: "default", text: listing.models.find((item) => item.ref === name)?.label ?? name };
}

/** The model the next session will use, as a chip that opens the model dialog. */
export function NewSessionModelChipView({ label, onOpen }: { label: NewSessionModelLabel; onOpen: (trigger: HTMLElement) => void }) {
  const text = label.kind === "none" ? "Choose a model" : label.kind === "loading" ? "Model" : label.text;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      {...(label.kind === "auto" ? { title: AUTO_MODEL_HINT } : {})}
      aria-label={label.kind === "default" ? `Model: ${text}, default` : label.kind === "pick" || label.kind === "auto" ? `Model: ${text}` : text}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        badgeVariants({ tone: label.kind === "none" ? "wait" : "neutral" }),
        "cursor-pointer outline-offset-2 outline-clay hover:border-line-strong focus-visible:outline-2",
        label.kind === "none" ? "" : "hover:text-ink",
      )}
    >
      <span aria-hidden="true">◇</span>
      {text}
      {label.kind === "default" ? <span className="text-faint">· default</span> : null}
      <ChevronDownIcon className="size-3" />
    </button>
  );
}

/** The chip on the live page: the pick, or the default; it opens the model dialog in new-session mode. */
export function NewSessionModelChip() {
  const [pick] = useNewSessionModel();
  const listing = useModelList();
  const routing = useRouting();
  return (
    <NewSessionModelChipView
      label={newSessionModelLabel(listing.data ?? null, pick, routing.data ?? null)}
      onOpen={(trigger) => openModelDialog({ sessionId: null, returnTo: trigger })}
    />
  );
}
