import {
  namesModel,
  pickerGroups,
  pickerName,
  planTry,
  providerMissing,
  startedTry,
  tryTitle,
  tuneState,
  type Category,
  type TryPlan,
} from "@golem/view";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import { useModelList, useNavigate, useNewSessionModel, usePageActions, usePulls, useSessionOptions, useSessionReader, useSessionSlice } from "../../store/page-context.tsx";
import { sessionPath } from "../../store/router.ts";
import type { SessionView } from "../../store/session-store.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { RefreshIcon, SlidersIcon } from "../../ui/icons.tsx";
import { resolveActive } from "../../ui/search-list.tsx";
import { CategoryChips } from "./category-chips.tsx";
import { listRows, ModelList } from "./model-list.tsx";
import { TuneView, type TryBackend, type TuneBackend } from "./tune-view.tsx";
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

export type ModelDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /**
   * "session" changes one session's model. "new" picks the model of the next new session: `session`
   * then holds the pick, if there is one, and the main button says `Use for the new session`.
   * "default" changes the model that new sessions start with: `Make default` is the main button, and
   * there is no session to use it for.
   */
  mode?: "session" | "new" | "default";
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
  /** What the Tune view reads and writes. Without it a row has no Tune button. */
  tune?: TuneBackend;
  /** Where the dialog starts, for the gallery. `tune` is the ref of the model whose Tune view is open. */
  initial?: { tune?: string; query?: string; category?: Category; activeId?: string; confirm?: ModelConfirm; failure?: string };
};

/** The list, or the Tune view of one model (its ref). */
type View = "list" | { tune: string };

const NO_OPTIONS: Readonly<Record<string, never>> = {};

/** Only a local model that is installed has options: they are Ollama's. */
function tunable(model: ListedModel): boolean {
  return model.provider === "ollama" && model.status === "ready";
}

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
  const { session, listing, loadError, onRetry, pulls, actions, initial, showAll, onShowAll, tune } = props;
  const isNew = props.mode === "new";
  const isDefaultMode = props.mode === "default";
  const [query, setQuery] = useState(initial?.query ?? "");
  const [category, setCategory] = useState<Category | null>(initial?.category ?? null);
  const [activeId, setActiveId] = useState<string | null>(initial?.activeId ?? null);
  const [confirmState, setConfirm] = useState<ModelConfirm | null>(initial?.confirm ?? null);
  const [failure, setFailure] = useState<Failure | null>(
    initial?.failure === undefined ? null : { ref: initial.activeId ?? null, text: initial.failure },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>(initial?.tune === undefined ? "list" : { tune: initial.tune });
  const tuneButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const shown = useMemo(() => withActivePulls(listing, pulls), [listing, pulls]);
  const groups = useMemo(() => (shown === null ? [] : pickerGroups(shown, query, category)), [shown, query, category]);
  const rows = useMemo(() => listRows(groups), [groups]);
  const active = resolveActive(rows, activeId);
  const model = active?.model ?? null;
  const missing = model !== null && providerMissing(shown, model.provider);
  const confirm = confirmFits(confirmState, model, missing) ? confirmState : null;
  const error = failure !== null && (failure.ref === null || failure.ref === model?.ref) ? failure.text : null;
  const profile = session?.profile ?? null;
  // A Tune view tunes the model of the row it was opened from, and only the session's own model has a session.
  const tuning = typeof view === "object" ? (shown?.models.find((item) => item.ref === view.tune) ?? null) : null;
  const tuneBackend =
    tune === undefined || tuning === null
      ? undefined
      : namesModel(tuning, profile)
        ? tune
        : { ...tune, sessionId: null, sessionOptions: NO_OPTIONS };
  const inTune = tuning !== null && tuneBackend !== undefined;
  const leaving = useRef<string | null>(null);

  function openTune(target: ListedModel): void {
    if (tune === undefined || !tunable(target) || busy !== null) return;
    setActiveId(target.ref);
    setView({ tune: target.ref });
  }

  function closeTune(): void {
    if (typeof view === "object") leaving.current = view.tune;
    setView("list");
  }

  // Back on the list: focus goes to the row's Tune button, and the row's fit is read again, since
  // `num_ctx` changes it. The read waits a tick so a change on its way is sent first.
  useEffect(() => {
    const ref = leaving.current;
    if (view !== "list" || ref === null) return;
    leaving.current = null;
    tuneButton.current?.focus();
    const timer = setTimeout(() => void actions.refresh().catch(() => undefined), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
        if (typeof view === "object") {
          event.preventDefault();
          closeTune();
        } else if (confirm !== null) {
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
      if (isDefaultMode) {
        if (!namesModel(target, listing?.default ?? null)) void makeDefault(target);
      } else if (!namesModel(target, profile)) {
        void switchTo(target);
      }
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
      <p className="px-3 py-6 text-center text-sm text-muted">{query === "" && category === null ? "No models found." : "No matching models."}</p>
    );

  const modelsPanel = (
    <div hidden={inTune} className="flex min-h-0 flex-1 flex-col">
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
      <CategoryChips className="mt-3" value={category} onChange={setCategory} disabled={busy !== null} />
      <ModelList
        className="mt-3 min-h-0 flex-1"
        listClassName="flex-1"
        listing={shown}
        groups={groups}
        profile={profile}
        category={category}
        pulls={pulls}
        inputRef={input}
        query={query}
        onQueryChange={setQuery}
        activeId={active?.id ?? null}
        onActiveChange={setActiveId}
        onActivate={primary}
        empty={empty}
        after={shown === null ? null : <ProviderNotes listing={shown} />}
        onTune={tune === undefined ? undefined : openTune}
        tunable={tunable}
        footer={
          <div className="mt-4 flex shrink-0 flex-col gap-3 border-t border-line pt-4">
            {error === null ? null : (
              <p role="alert" className="text-sm text-deny">
                {error}
              </p>
            )}
            {model === null || shown === null ? (
              <IdleBar defaultOnly={isDefaultMode} useLabel={isNew ? "Use for the new session" : "Use for this session"} />
            ) : confirm !== null ? (
              <ConfirmBar
                confirm={confirm}
                model={model}
                listing={shown}
                use={!isNew && !isDefaultMode}
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
                defaultOnly={isDefaultMode}
                isCurrent={namesModel(model, profile)}
                isDefault={namesModel(model, listing?.default ?? null)}
                busy={busy}
                onUse={() => void switchTo(model)}
                onDefault={() => void makeDefault(model)}
                onDownload={() => ask({ kind: "pull", ref: model.ref, step: 1 })}
                onStop={() => void stop(model)}
                onRemove={() => ask({ kind: "remove", ref: model.ref })}
                onTune={tune !== undefined && tunable(model) ? () => openTune(model) : undefined}
                tuneRef={tuneButton}
              />
            )}
          </div>
        }
      />
    </div>
  );

  // The title and the description stay in the Tune view, for the dialog's name, but only the list shows them.
  return (
    <>
      <div className={cn("flex shrink-0 items-start gap-3", inTune && "sr-only")}>
        <div className="min-w-0 flex-1">
          <DialogTitle>Choose a model</DialogTitle>
          <DialogDescription>{description(isNew || isDefaultMode ? null : session, listing)}</DialogDescription>
        </div>
        {inTune ? null : (
          <IconButton
            label="Refresh the list"
            aria-busy={busy === "refresh"}
            disabled={busy !== null}
            onClick={() => void run("refresh", null, actions.refresh, "Could not refresh the list.")}
          >
            <RefreshIcon />
          </IconButton>
        )}
      </div>
      {modelsPanel}
      {inTune ? (
        <TuneView key={tuning.ref} model={tuning.ref.replace(/^ollama\//, "")} label={tuning.label} backend={tuneBackend} onBack={closeTune} />
      ) : null}
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

/** The bar before anything is picked: the same place as the real one, so the dialog does not move. */
function IdleBar({ defaultOnly, useLabel }: { defaultOnly: boolean; useLabel: string }) {
  return (
    <div role="group" aria-label="Actions" className="flex flex-wrap items-center justify-end gap-2">
      <Button kind={defaultOnly ? "ink" : "secondary"} disabled>
        Make default
      </Button>
      {defaultOnly ? null : (
        <Button kind="ink" disabled>
          {useLabel}
        </Button>
      )}
    </div>
  );
}

function ActionBar({
  model,
  missing,
  useLabel,
  defaultOnly,
  isCurrent,
  isDefault,
  busy,
  onUse,
  onDefault,
  onDownload,
  onStop,
  onRemove,
  onTune,
  tuneRef,
}: {
  model: ListedModel;
  missing: boolean;
  useLabel: string;
  /** Changing the default: it is the main button, and there is no session to use the model for. */
  defaultOnly: boolean;
  isCurrent: boolean;
  isDefault: boolean;
  busy: string | null;
  onUse: () => void;
  onDefault: () => void;
  onDownload: () => void;
  onStop: () => void;
  onRemove: () => void;
  /** Opens the Tune view. Only a local model that is installed has one. */
  onTune?: (() => void) | undefined;
  tuneRef: RefObject<HTMLButtonElement | null>;
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
        {onTune === undefined ? null : (
          <Button ref={tuneRef} kind="secondary" disabled={!idle} onClick={onTune}>
            <SlidersIcon />
            Tune
          </Button>
        )}
        <Button
          kind={defaultOnly ? "ink" : "secondary"}
          disabled={!idle || isDefault}
          aria-busy={busy === "default"}
          onClick={onDefault}
        >
          {isDefault ? "Default" : "Make default"}
        </Button>
        {defaultOnly ? null : (
          <Button kind="ink" disabled={!idle || isCurrent} aria-busy={busy === "use"} onClick={onUse}>
            {isCurrent ? "In use" : useLabel}
          </Button>
        )}
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
        className="flex h-full max-h-dialog max-w-2xl flex-col overflow-hidden"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => guardRef.current?.escape(event)}
      >
        <Content props={props} guardRef={guardRef} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Only the plan's refusal reads this, so any table will do. */
const NO_TUNE = tuneState({ model: "", options: [], defaults: {}, saved: {}, session: {} });

const selectBlocked = (view: SessionView): TryBackend["blocked"] => {
  const plan = planTry(view.chat, NO_TUNE);
  return plan.kind === "refused" ? plan.reason : null;
};

type Trying = { sessionId: string; forkId: string; plan: Extract<TryPlan, { kind: "try" }>; heading: string; before: number };

/** The model dialog for one session. The listing is fetched while it is open. */
export function ModelDialog({
  sessionId,
  session,
  open,
  onOpenChange,
  onCloseAutoFocus,
  initial,
  mode,
}: {
  /** The session the model is for, or null to pick the model of the next new session. */
  sessionId: string | null;
  /** "default" changes the default model instead: no session, and no pick for the next one. */
  mode?: "default";
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
  const tuneSession = mode === "default" ? null : sessionId;
  const sessionOptions = useSessionOptions(tuneSession);
  const navigate = useNavigate();
  const blocked = useSessionSlice(tuneSession, selectBlocked);
  const [trying, setTrying] = useState<Trying | null>(null);
  const current = trying !== null && trying.sessionId === tuneSession ? trying : null;
  const forkChat = useSessionSlice(current?.forkId ?? null, (view) => view.chat);
  const run = useMemo(() => {
    if (current === null) return null;
    const started = forkChat.messages.filter((message) => message.role === "user").length > current.before;
    return { ...startedTry(current.forkId, current.plan, current.heading), started, chat: forkChat };
  }, [current, forkChat]);
  const store = useSessionReader(tuneSession);
  const again = useMemo<TryBackend | undefined>(() => {
    if (tuneSession === null) return undefined;
    const chat = () => store().view.chat;
    return {
      blocked,
      plan: (tune) => planTry(chat(), tune),
      start: async (plan, heading) => {
        const { view, summary } = store();
        // The fork's history ends at `forkAt`, so the question it gets is one more user message than that holds.
        const messages = view.chat.messages;
        const end = plan.forkAt === null ? -1 : messages.findIndex((message) => message.id === plan.forkAt);
        const before = messages.slice(0, end + 1).filter((message) => message.role === "user").length;
        const title = tryTitle(summary?.title ?? view.title, plan.text);
        const forkId =
          plan.forkAt === null
            ? await page.createSession(view.cwd, view.model?.profile ?? null)
            : await page.fork(tuneSession, plan.forkAt);
        setTrying({ sessionId: tuneSession, forkId, plan, heading, before });
        await page.rename(forkId, title);
        await page.setSessionOptions(forkId, plan.options);
        await page.send(forkId, plan.text);
      },
      run,
      open: (id) => {
        navigate(sessionPath(id));
        onOpenChange(false);
      },
    };
  }, [tuneSession, blocked, run, store, page, navigate, onOpenChange]);
  const tune = useMemo<TuneBackend>(
    () => ({
      sessionId: tuneSession,
      load: (name, sessionId) => page.modelOptions(name, sessionId),
      save: (name, options) => page.saveModelOptions(name, options),
      setSession: (options) => page.setSessionOptions(tuneSession ?? "", options),
      watchSaved: (listener) => page.watchSavedOptions(listener),
      sessionOptions,
      again,
    }),
    [page, tuneSession, sessionOptions, again],
  );
  return (
    <ModelDialogView
      open={open}
      onOpenChange={onOpenChange}
      tune={tune}
      onCloseAutoFocus={onCloseAutoFocus}
      mode={mode ?? (sessionId === null ? "new" : "session")}
      session={mode === "default" ? null : sessionId === null ? (pick === null ? null : { profile: pick, name: null }) : session}
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
