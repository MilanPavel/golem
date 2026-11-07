import { namesModel, pickerGroups, pickerName, providerMissing } from "@golem/view";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import { useModelList, useNewSessionModel, usePageActions, usePulls } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { RefreshIcon } from "../../ui/icons.tsx";
import { resolveActive, SearchList, type SearchListItem } from "../../ui/search-list.tsx";
import { ModelRow } from "./model-row.tsx";
import { diskText, downloadText, removable, removeText, shortName, tooBigText, withActivePulls } from "./model-text.ts";

/** What the dialog does, with the session already bound. Each call rejects with the daemon's message. */
export type ModelDialogActions = {
  /** Use the model for this session. */
  use(name: string): Promise<void>;
  setDefault(name: string): Promise<void>;
  /** Download the model, then use it for this session. */
  pull(ref: string): Promise<void>;
  stop(ref: string): Promise<void>;
  remove(ref: string): Promise<void>;
  refresh(): Promise<void>;
};

/** The question in the footer, for the active row. A model too big asks twice. */
export type ModelConfirm = { kind: "pull"; ref: string; step: 1 | 2 } | { kind: "remove"; ref: string };

type Failure = { ref: string | null; text: string };
type Row = SearchListItem & { model: ListedModel };

export type ModelDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /**
   * "session" changes one session's model. "new" picks the model of the next new session: `session`
   * then holds the pick, if there is one, and the main button says `Use for the new session`.
   */
  mode?: "session" | "new";
  /** The session's model (or, in new mode, the pick): the profile to match on, and the name to show. */
  session: { profile: string; name: string | null } | null;
  listing: ModelListResult | null;
  /** Why the first fetch failed. Ignored while there is a listing. */
  loadError: string | null;
  onRetry: () => void;
  pulls: PullsSnapshot;
  actions: ModelDialogActions;
  /** The list shows every live chat model that calls tools, not only the catalog's. */
  showAll?: boolean;
  /** Turns show all on or off. Without it the dialog has no such switch. */
  onShowAll?: (on: boolean) => void;
  /** Where the dialog starts, for the gallery. */
  initial?: { query?: string; activeId?: string; confirm?: ModelConfirm; failure?: string };
};

type Guard = { busy: boolean; escape: (event: Event) => void };

function confirmFits(confirm: ModelConfirm | null, model: ListedModel | null, missing: boolean): confirm is ModelConfirm {
  if (confirm === null || model === null || confirm.ref !== model.ref) {
    return false;
  }
  return confirm.kind === "pull" ? model.status === "not_installed" && !missing : removable(model) && model.status === "ready";
}

function description(session: ModelDialogViewProps["session"], listing: ModelListResult | null): string {
  const mine = session === null ? "" : `This session uses ${session.name ?? session.profile}.`;
  const next = listing === null ? "" : listing.default === null ? "No default yet." : `New sessions use ${listing.default}.`;
  return [mine, next].filter((part) => part !== "").join(" ");
}

function ProviderNotes({ listing }: { listing: ModelListResult }) {
  const notes = listing.providers.flatMap((item) => {
    if (item.status === "needs_key") {
      return [
        <li key={item.provider}>
          {item.provider}: run <code className="font-mono text-ink">golem auth set {item.provider}</code> to list its models
        </li>,
      ];
    }
    if (item.status === "server_down") return [<li key={item.provider}>{item.provider}: not answering</li>];
    if (item.status === "not_installed") return [<li key={item.provider}>{item.provider}: not installed</li>];
    return [];
  });
  return notes.length === 0 ? null : <ul className="mt-3 flex flex-col gap-1 px-3 text-xs text-muted">{notes}</ul>;
}

function Content({
  props,
  guardRef,
  close,
}: {
  props: ModelDialogViewProps;
  guardRef: RefObject<Guard | null>;
  close: () => void;
}) {
  const { session, listing, loadError, onRetry, pulls, actions, initial, showAll, onShowAll } = props;
  const isNew = props.mode === "new";
  const [query, setQuery] = useState(initial?.query ?? "");
  const [activeId, setActiveId] = useState<string | null>(initial?.activeId ?? null);
  const [confirmState, setConfirm] = useState<ModelConfirm | null>(initial?.confirm ?? null);
  const [failure, setFailure] = useState<Failure | null>(
    initial?.failure === undefined ? null : { ref: initial.activeId ?? null, text: initial.failure },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const shown = useMemo(() => withActivePulls(listing, pulls), [listing, pulls]);
  const rows = useMemo<Row[]>(
    () =>
      shown === null
        ? []
        : pickerGroups(shown, query).flatMap((group) =>
            group.models.map((model) => ({ id: model.ref, group: group.title, model })),
          ),
    [shown, query],
  );
  const active = resolveActive(rows, activeId);
  const model = active?.model ?? null;
  const missing = model !== null && providerMissing(shown, model.provider);
  const confirm = confirmFits(confirmState, model, missing) ? confirmState : null;
  const error = failure !== null && (failure.ref === null || failure.ref === model?.ref) ? failure.text : null;
  const profile = session?.profile ?? null;

  // The question takes focus, so a keyboard user hears it and answers it; answering gives focus back.
  const confirmKey = confirm === null ? "" : `${confirm.kind}:${confirm.ref}:${confirm.kind === "pull" ? confirm.step : 0}`;
  const askedBefore = useRef("");
  useEffect(() => {
    if (confirmKey !== "") confirmButton.current?.focus();
    else if (askedBefore.current !== "") input.current?.focus();
    askedBefore.current = confirmKey;
  }, [confirmKey]);

  useEffect(() => {
    guardRef.current = {
      busy: busy !== null,
      escape(event) {
        if (confirm !== null) {
          event.preventDefault();
          setConfirm(null);
        } else if (query !== "") {
          event.preventDefault();
          setQuery("");
        }
      },
    };
  });

  async function run(name: string, ref: string | null, action: () => Promise<void>, fallback: string, done?: () => void) {
    setBusy(name);
    setFailure(null);
    try {
      await action();
      done?.();
    } catch (err) {
      setFailure({ ref, text: actionErrorText(err, fallback) });
    } finally {
      setBusy(null);
    }
  }

  const switchTo = (target: ListedModel) =>
    run("use", target.ref, () => actions.use(pickerName(target)), "Could not switch the model.", close);
  const makeDefault = (target: ListedModel) =>
    run("default", target.ref, () => actions.setDefault(pickerName(target)), "Could not make it the default.");
  const stop = (target: ListedModel) =>
    run("stop", target.ref, () => actions.stop(target.ref), "Could not stop the download.");
  const ask = (next: ModelConfirm) => {
    setFailure(null);
    setConfirm(next);
  };

  function accept(): void {
    if (confirm === null || model === null) return;
    if (confirm.kind === "pull") {
      if (confirm.step === 1 && model.fit === "too_big") {
        setConfirm({ ...confirm, step: 2 });
        return;
      }
      void run("pull", model.ref, () => actions.pull(model.ref), "Could not start the download.", () => setConfirm(null));
    } else {
      void run("remove", model.ref, () => actions.remove(model.ref), "Could not remove the model.", () => setConfirm(null));
    }
  }

  function primary(target: ListedModel): void {
    if (busy !== null) return;
    if (confirm !== null) {
      accept();
    } else if (target.status === "ready") {
      if (!namesModel(target, profile)) void switchTo(target);
    } else if (target.status === "not_installed" && !providerMissing(shown, target.provider)) {
      ask({ kind: "pull", ref: target.ref, step: 1 });
    }
  }

  const empty =
    shown === null ? (
      loadError === null ? (
        <p role="status" className="px-3 py-6 text-center text-sm text-muted">
          Loading models…
        </p>
      ) : (
        <div role="alert" className="flex flex-col items-center gap-3 px-3 py-6 text-center text-sm text-deny">
          <p>Could not list models: {loadError}</p>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )
    ) : (
      <p className="px-3 py-6 text-center text-sm text-muted">{query === "" ? "No models found." : "No matching models."}</p>
    );

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle>Choose a model</DialogTitle>
          <DialogDescription>{description(isNew ? null : session, listing)}</DialogDescription>
        </div>
        <IconButton
          label="Refresh the list"
          aria-busy={busy === "refresh"}
          disabled={busy !== null}
          onClick={() => void run("refresh", null, actions.refresh, "Could not refresh the list.")}
        >
          <RefreshIcon />
        </IconButton>
      </div>
      {onShowAll === undefined ? null : (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showAll === true}
            disabled={busy !== null}
            onChange={(event) => onShowAll(event.target.checked)}
          />
          Show all models
        </label>
      )}
      <SearchList
        className="mt-4"
        listClassName="max-h-64 sm:max-h-96"
        label="Search models"
        placeholder="Search models"
        inputRef={input}
        items={rows}
        query={query}
        onQueryChange={setQuery}
        activeId={active?.id ?? null}
        onActiveChange={setActiveId}
        onActivate={(row) => primary(row.model)}
        empty={empty}
        after={shown === null ? null : <ProviderNotes listing={shown} />}
        renderItem={(row) => (
          <ModelRow
            model={row.model}
            providerMissing={providerMissing(shown, row.model.provider)}
            current={namesModel(row.model, profile)}
            isDefault={namesModel(row.model, listing?.default ?? null)}
            pull={pulls.active.get(row.model.ref)}
            failed={pulls.failed.get(row.model.ref)}
          />
        )}
      />
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 empty:hidden">
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny">
            {error}
          </p>
        )}
        {model === null || shown === null ? null : confirm !== null ? (
          <ConfirmBar
            confirm={confirm}
            model={model}
            listing={shown}
            use={!isNew}
            busy={busy}
            buttonRef={confirmButton}
            onAccept={accept}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <ActionBar
            model={model}
            missing={missing}
            useLabel={isNew ? "Use for the new session" : "Use for this session"}
            isCurrent={namesModel(model, profile)}
            isDefault={namesModel(model, listing?.default ?? null)}
            busy={busy}
            onUse={() => void switchTo(model)}
            onDefault={() => void makeDefault(model)}
            onDownload={() => ask({ kind: "pull", ref: model.ref, step: 1 })}
            onStop={() => void stop(model)}
            onRemove={() => ask({ kind: "remove", ref: model.ref })}
          />
        )}
      </div>
    </>
  );
}

function ConfirmBar({
  confirm,
  model,
  listing,
  use,
  busy,
  buttonRef,
  onAccept,
  onCancel,
}: {
  confirm: ModelConfirm;
  model: ListedModel;
  listing: ModelListResult;
  /** The download is followed by using the model; a new session's pick is not. */
  use: boolean;
  busy: string | null;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const tooBig = confirm.kind === "pull" && confirm.step === 1 ? tooBigText(model, listing) : null;
  const text = confirm.kind === "remove" ? removeText(model) : (tooBig ?? downloadText(model, use));
  const disk = confirm.kind === "pull" && tooBig === null ? diskText(model, listing) : null;
  const label = confirm.kind === "remove" ? "Remove" : tooBig === null ? "Download" : "Download anyway";
  return (
    <div role="group" aria-label="Confirm" className="flex flex-col gap-3">
      <p className="text-sm text-ink">{text}</p>
      {disk === null ? null : <p className="text-sm text-wait">{disk}</p>}
      <div className="flex justify-end gap-2">
        <Button kind="secondary" disabled={busy !== null} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          ref={buttonRef}
          kind={confirm.kind === "remove" ? "danger" : "ink"}
          disabled={busy !== null}
          aria-busy={busy === "pull" || busy === "remove"}
          onClick={onAccept}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

function ActionBar({
  model,
  missing,
  useLabel,
  isCurrent,
  isDefault,
  busy,
  onUse,
  onDefault,
  onDownload,
  onStop,
  onRemove,
}: {
  model: ListedModel;
  missing: boolean;
  useLabel: string;
  isCurrent: boolean;
  isDefault: boolean;
  busy: string | null;
  onUse: () => void;
  onDefault: () => void;
  onDownload: () => void;
  onStop: () => void;
  onRemove: () => void;
}) {
  const idle = busy === null;
  let buttons;
  if (model.status === "ready") {
    buttons = (
      <>
        {removable(model) ? (
          <Button kind="danger" disabled={!idle} onClick={onRemove} className="mr-auto">
            Remove
          </Button>
        ) : null}
        <Button kind="secondary" disabled={!idle || isDefault} aria-busy={busy === "default"} onClick={onDefault}>
          {isDefault ? "Default" : "Make default"}
        </Button>
        <Button kind="ink" disabled={!idle || isCurrent} aria-busy={busy === "use"} onClick={onUse}>
          {isCurrent ? "In use" : useLabel}
        </Button>
      </>
    );
  } else if (model.status === "not_installed" && !missing) {
    buttons = (
      <Button kind="ink" disabled={!idle} onClick={onDownload}>
        Download
      </Button>
    );
  } else if (model.status === "pulling") {
    buttons = (
      <Button kind="secondary" disabled={!idle} aria-busy={busy === "stop"} onClick={onStop}>
        Stop download
      </Button>
    );
  } else {
    return null;
  }
  return (
    <div role="group" aria-label={`Actions for ${shortName(model.ref)}`} className="flex flex-wrap items-center justify-end gap-2">
      {buttons}
    </div>
  );
}

/**
 * Pick a model for the session: search the list, then use it, make it the default, download it,
 * stop the download, or remove it. The view takes everything as props, so the gallery can show
 * every state; `ModelDialog` is the connected one.
 */
export function ModelDialogView(props: ModelDialogViewProps) {
  const { open, onOpenChange, onCloseAutoFocus } = props;
  const guardRef = useRef<Guard | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && guardRef.current?.busy === true) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-screen max-w-2xl overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => guardRef.current?.escape(event)}
      >
        <Content props={props} guardRef={guardRef} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The model dialog for one session. The listing is fetched while it is open. */
export function ModelDialog({
  sessionId,
  session,
  open,
  onOpenChange,
  onCloseAutoFocus,
  initial,
}: {
  /** The session the model is for, or null to pick the model of the next new session. */
  sessionId: string | null;
  session: { profile: string; name: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Where the dialog starts: a model made active, and the question asked of it. */
  initial?: ModelDialogViewProps["initial"];
}) {
  const [showAll, setShowAll] = useState(false);
  const query = useModelList(open, showAll);
  const pulls = usePulls();
  const page = usePageActions();
  const [pick, choosePick] = useNewSessionModel();
  const actions = useMemo<ModelDialogActions>(
    () => ({
      use: (name) => {
        if (sessionId !== null) return page.useModel(sessionId, name);
        choosePick(name);
        return Promise.resolve();
      },
      setDefault: (name) => page.setDefault(name),
      pull: (ref) => page.pull(ref, sessionId === null ? undefined : { sessionId }),
      stop: (ref) => page.cancelPull(ref),
      remove: (ref) => page.remove(ref),
      refresh: async () => {
        await page.refreshModels(showAll);
      },
    }),
    [page, sessionId, choosePick, showAll],
  );
  return (
    <ModelDialogView
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      mode={sessionId === null ? "new" : "session"}
      session={sessionId === null ? (pick === null ? null : { profile: pick, name: null }) : session}
      listing={query.data ?? null}
      loadError={query.error === null ? null : query.error.message}
      onRetry={() => void query.refetch()}
      pulls={pulls}
      actions={actions}
      showAll={showAll}
      onShowAll={setShowAll}
      initial={initial}
    />
  );
}
