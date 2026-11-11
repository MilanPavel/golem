import type { ModelOptionsGetResult, ModelOptionsSetResult, SessionSetOptionsResult } from "../../store/model-options.ts";
import {
  applyPreset,
  defaultNote,
  differsFromDefault,
  formatTuneValue,
  groupRows,
  activePreset,
  isListKind,
  NUM_CTX_START,
  keepSession,
  KEEP_ALIVE_STEPS,
  memoryNote,
  NO_QUESTION_NOTICE,
  PRESETS,
  RUNNING_NOTICE,
  tryAnswer,
  tryHeading,
  toggleTarget,
  tuneRows,
  tuneState,
  withSaved,
  withSession,
  type MemoryFit,
  type TunePreset,
  type TuneRow,
  type TuneState,
  type TuneTarget,
  type TuneValue,
  type TryPlan,
  type TryRun,
} from "@golem/view";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { sessionPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { ChevronLeftIcon, RefreshIcon } from "../../ui/icons.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { cn } from "../../ui/cn.ts";

/** What Try again needs of the session whose model is tuned. Absent for any other model. */
export type TryBackend = {
  /** Why a try cannot start now: the chat has no question yet, or its run goes on. */
  blocked: "no-question" | "running" | null;
  /** What a try would ask, from the chat as it is now and the panel's values. */
  plan(tune: TuneState): TryPlan;
  /** Forks the chat, names and tunes the fork, and sends the question to it. The answer comes back in `run`. */
  start(plan: Extract<TryPlan, { kind: "try" }>, heading: string): Promise<void>;
  /** The try in progress or done, with the fork's chat. */
  run: TryRun | null;
  /** Opens the fork as a session. */
  open(sessionId: string): void;
};

/** What the Tune view needs of the page, with the session already bound. */
export type TuneBackend = {
  /** The session a change can be limited to, or null when the dialog has none. */
  sessionId: string | null;
  /** The model's options, with the overrides of `sessionId` when there is one. */
  load(model: string, sessionId: string | null): Promise<ModelOptionsGetResult>;
  save(model: string, options: Record<string, TuneValue | null>): Promise<ModelOptionsSetResult>;
  setSession(options: Record<string, TuneValue | null>): Promise<SessionSetOptionsResult>;
  /** What is saved for a model changed, from any client. Returns the way to stop listening. */
  watchSaved(listener: (model: string, saved: Readonly<Record<string, TuneValue>>) => void): () => void;
  /** The session's overrides, live from `model.options.changed`. */
  sessionOptions: Readonly<Record<string, TuneValue>>;
  /** Try again, for the session's own model. */
  again?: TryBackend | undefined;
};

/** How long a drag waits before it is sent. */
export const TUNE_DEBOUNCE_MS = 300;

export const HOSTED_TEXT = "Tuning is for local Ollama models.";

const KEEP_ALIVE_LABELS = new Map<string, string>([
  ["0", "0"],
  ["30s", "30s"],
  ["5m", "5m"],
  ["30m", "30m"],
  ["-1", "always"],
]);

/** How long the rows a preset moved stay lit. */
export const LIT_MS = 1500;

const FIT_CLASS: Record<MemoryFit, string> = { fits: "text-allow", tight: "text-wait", too_big: "text-deny" };

type Pending = { timer: ReturnType<typeof setTimeout>; model: string; target: TuneTarget; value: TuneValue | null };

/** Writes one value into the layer a change goes to, or removes it with null. */
function write(state: TuneState, name: string, value: TuneValue | null): TuneState {
  const layer: Record<string, TuneValue> = { ...state[state.target] };
  if (value === null) delete layer[name];
  else layer[name] = value;
  const next = state.target === "saved" ? withSaved(state, state.model, layer) : withSession(state, layer);
  // A change by hand ends the preset's name and its highlight.
  const rest: TuneState = { ...next };
  delete rest.preset;
  delete rest.lit;
  return rest;
}

/** The state with the target a change can really go to: with no session, it is the model's. */
function viewOf(state: TuneState, canSession: boolean): TuneState {
  return canSession || state.target === "saved" ? state : toggleTarget(state);
}

type Choice = { value: TuneValue | null; label: string };

const SEG_CLASS = "inline-flex w-fit max-w-full gap-0.5 rounded-md border border-line-strong bg-bg p-0.5";
const SEG_BUTTON_CLASS =
  "rounded-sm border border-transparent px-3 py-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2 aria-checked:border-line-strong aria-checked:bg-surface aria-checked:text-ink disabled:pointer-events-none disabled:opacity-50";
const NUMBER_CLASS =
  "w-24 rounded-md border border-line-strong bg-surface px-2 py-1 font-mono text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2 disabled:bg-sunken disabled:text-faint";

/** A row of radios in one box. Arrow keys move and pick; with nothing checked, the first can take focus. */
function Segmented({
  label,
  choices,
  checked,
  onPick,
  disabled = false,
  title,
  wrap = false,
}: {
  label: string;
  choices: readonly { label: string }[];
  /** Index of the checked radio, or -1 for none. */
  checked: number;
  onPick: (index: number) => void;
  disabled?: boolean;
  title?: string | undefined;
  /** Lets the radios wrap on a narrow screen. */
  wrap?: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const stop = checked >= 0 ? checked : 0;
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (by === 0 || disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    // Left would also leave the view, so the group takes it.
    event.preventDefault();
    const next = (stop + by + choices.length) % choices.length;
    onPick(next);
    buttons.current[next]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} title={title} className={cn(SEG_CLASS, wrap && "flex-wrap")} onKeyDown={onKeyDown}>
      {choices.map((choice, index) => (
        <button
          key={choice.label}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={index === checked}
          tabIndex={index === stop ? 0 : -1}
          disabled={disabled}
          onClick={() => onPick(index)}
          className={SEG_BUTTON_CLASS}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** A mode radio plus a number: the answer length (until done, fill context, limit) and the seed (random, fixed). */
function ModeNumber({ row, onChange }: { row: TuneRow; onChange: (value: TuneValue | null) => void }) {
  const { option, value } = row;
  const length = option.name === "num_predict";
  const modes: Choice[] = length
    ? [
        { value: -1, label: "Until done" },
        { value: -2, label: "Fill context" },
        { value: null, label: "Limit" },
      ]
    : [
        { value: null, label: "Random" },
        { value: null, label: "Fixed" },
      ];
  const low = length ? 1 : (option.minimum ?? 0);
  const high = option.maximum ?? Number.MAX_SAFE_INTEGER;
  const clamp = (n: number) => Math.min(high, Math.max(low, n));
  const fixed = typeof value === "number" && (length ? value >= 0 : true);
  const checked = length ? (value === -2 ? 1 : fixed ? 2 : 0) : fixed ? 1 : 0;
  const numeric = fixed && typeof value === "number" ? value : null;
  const [draft, setDraft] = useState(numeric === null ? (length ? "4096" : "42") : String(numeric));
  const [synced, setSynced] = useState(numeric);
  if (synced !== numeric) {
    setSynced(numeric);
    if (numeric !== null && Number(draft) !== numeric && draft !== "") setDraft(String(numeric));
  }
  const remembered = clamp(Number.isFinite(Number(draft)) && draft !== "" ? Math.trunc(Number(draft)) : length ? 4096 : 42);
  function pick(index: number): void {
    if (length) onChange(index === 0 ? -1 : index === 1 ? -2 : remembered);
    else onChange(index === 0 ? null : remembered);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label={option.label} choices={modes} checked={checked} onPick={pick} />
      <input
        type="number"
        inputMode="numeric"
        aria-label={length ? "Answer length limit" : "Seed value"}
        min={low}
        max={high}
        step={1}
        disabled={!fixed}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (/^\d+$/.test(event.target.value)) onChange(clamp(Number(event.target.value)));
        }}
        className={NUMBER_CLASS}
      />
    </div>
  );
}

function RowControl({ row, id, onChange }: { row: TuneRow; id: string; onChange: (value: TuneValue | null) => void }) {
  const { option, value } = row;
  if (option.kind === "choice") {
    const choices: Choice[] = [{ value: null, label: "Model default" }, ...(option.values ?? []).map((choice) => ({ value: choice, label: choice }))];
    const at = value === null ? 0 : choices.findIndex((choice) => choice.value === String(value));
    return <Segmented label={option.label} choices={choices} checked={at} onPick={(index) => onChange(choices[index]?.value ?? null)} />;
  }
  if (option.kind === "duration") {
    const current = value === null ? null : String(value);
    const choices: Choice[] = KEEP_ALIVE_STEPS.map((step) => ({ value: step, label: KEEP_ALIVE_LABELS.get(String(step)) ?? String(step) }));
    if (current !== null && !choices.some((choice) => String(choice.value) === current)) choices.push({ value: current, label: current });
    const at = current === null ? -1 : choices.findIndex((choice) => String(choice.value) === current);
    return <Segmented label={option.label} choices={choices} checked={at} onPick={(index) => onChange(choices[index]?.value ?? null)} />;
  }
  if (option.name === "num_predict" || option.name === "seed") return <ModeNumber row={row} onChange={onChange} />;
  // `num_ctx` with no default and no value: no thumb, and the first move starts at NUM_CTX_START.
  const unset = option.name === "num_ctx" && value === null;
  const minimum = option.minimum ?? 0;
  const maximum = option.maximum ?? 0;
  const fallback = typeof option.default === "number" ? option.default : null;
  const tick = fallback !== null && maximum > minimum ? Math.min(100, Math.max(0, ((fallback - minimum) / (maximum - minimum)) * 100)) : null;
  return (
    <div className="relative flex items-center">
      {tick === null ? null : <span aria-hidden="true" className="pointer-events-none absolute h-2.5 w-0.5 bg-faint/60" style={{ left: `${tick}%` }} />}
      <input
        id={id}
        type="range"
        min={minimum}
        max={maximum}
        step={option.step ?? 1}
        value={typeof value === "number" ? value : unset ? NUM_CTX_START : minimum}
        onChange={(event) => onChange(unset ? NUM_CTX_START : event.target.valueAsNumber)}
        className={cn(
          "relative min-w-0 flex-1 accent-clay",
          unset && "[&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-thumb]:opacity-0",
        )}
      />
    </div>
  );
}

/** The try's heading, the first line of the original answer, then the new answer as it streams. */
function TryBlock({ run, onOpen }: { run: TryRun; onOpen: () => void }) {
  const answer = tryAnswer(run);
  return (
    <section aria-label="Try" aria-live="polite" aria-busy={answer === null || answer.streaming} className="flex flex-col gap-1 rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <p className="font-mono text-xs text-ink">{run.heading}</p>
      {run.original === null ? null : <p className="truncate text-xs text-muted">was: {run.original}</p>}
      {answer === null || (answer.text === "" && answer.error === null) ? (
        <p className="text-muted">…</p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-ink">{answer.text}</p>
      )}
      {answer?.error == null ? null : <p className="text-xs text-deny">{answer.error}</p>}
      <div>
        <a
          href={sessionPath(run.sessionId)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpen();
          }}
          className="text-sm text-clay underline outline-offset-2 outline-clay focus-visible:outline-2"
        >
          Open the try session
        </a>
      </div>
    </section>
  );
}

/**
 * The options of one local model, one row each, with the same explanations as `/tune` in the
 * terminal. A change shows at once and is sent after the debounce: into `config.toml` for the model,
 * or into this session only. Presets and the memory gauge are the terminal's. What another client
 * changes shows here as soon as it arrives. It takes the dialog's body: the heading gets focus when
 * it opens, and `onBack` leaves it.
 */
export function TuneView({
  model,
  label,
  backend,
  onBack,
}: {
  /** The model's name as the daemon says it, without `ollama/`. */
  model: string;
  label: string;
  backend: TuneBackend;
  onBack: () => void;
}) {
  const ids = useId();
  const [state, setState] = useState<TuneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [didSave, setDidSave] = useState(false);
  const [starting, setStarting] = useState(false);
  const timers = useRef(new Map<string, Pending>());
  const inflight = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(0);
  const [seen, setSeen] = useState(backend.sessionOptions);
  const backendRef = useRef(backend);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    backendRef.current = backend;
  });
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const canSession = backend.sessionId !== null;
  const settled = () => timers.current.size === 0 && inflight.current === 0;
  const mirror = () => setBusy(timers.current.size + inflight.current);

  useEffect(() => {
    let current = true;
    backendRef.current.load(model, backendRef.current.sessionId).then(
      (result) => {
        if (current) setState(tuneState(result));
      },
      (failure: unknown) => {
        if (current) setError(actionErrorText(failure, "Could not read the options."));
      },
    );
    return () => {
      current = false;
    };
  }, [model, reload]);

  // What another client saves for this model shows at once, unless a change of ours is on its way.
  useEffect(
    () =>
      backend.watchSaved((name, saved) => {
        if (name === model && settled()) setState((open) => (open === null ? open : withSaved(open, name, saved)));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend.watchSaved, model],
  );

  // The session's overrides from `model.options.changed`, whoever set them, unless a change of ours is on its way.
  const overrides = backend.sessionOptions;
  if (seen !== overrides) {
    setSeen(overrides);
    if (canSession && busy === 0 && state !== null) setState(withSession(state, overrides));
  }

  // The rows a preset moved stay lit for a moment; the row's background fades back.
  const lit = state?.lit;
  useEffect(() => {
    if (lit === undefined) return;
    const timer = setTimeout(() => {
      setState((open) => {
        if (open === null || open.lit !== lit) return open;
        const next: TuneState = { ...open };
        delete next.lit;
        return next;
      });
    }, LIT_MS);
    return () => clearTimeout(timer);
  }, [lit]);

  /** Runs one write after the ones before it. A failure shows, and the options are read again. */
  function enqueue(job: () => Promise<void>): void {
    inflight.current += 1;
    setDidSave(false);
    mirror();
    queue.current = queue.current.then(async () => {
      let failed = false;
      try {
        await job();
      } catch (failure) {
        failed = true;
        setError(actionErrorText(failure, "Could not change the option."));
        setReload((count) => count + 1);
      } finally {
        inflight.current -= 1;
        mirror();
        if (!failed && settled()) setDidSave(true);
      }
    });
  }

  const alone = () => timers.current.size === 0 && inflight.current === 1;

  function send(entry: Pending, name: string): void {
    enqueue(async () => {
      if (entry.target === "saved") {
        const result = await backendRef.current.save(entry.model, { [name]: entry.value });
        if (alone()) setState((open) => (open === null ? open : withSaved(open, result.model, result.saved)));
      } else {
        const result = await backendRef.current.setSession({ [name]: entry.value });
        if (alone()) setState((open) => (open === null ? open : withSession(open, result.options)));
      }
    });
  }

  function schedule(name: string, value: TuneValue | null, delay: number, target: TuneTarget): void {
    const old = timers.current.get(name);
    if (old !== undefined) clearTimeout(old.timer);
    const entry = { model, target, value } as Pending;
    const fire = () => {
      timers.current.delete(name);
      send(entry, name);
    };
    entry.timer = setTimeout(fire, delay);
    timers.current.set(name, entry);
    setDidSave(false);
    mirror();
  }

  function change(name: string, value: TuneValue | null, delay: number): void {
    if (state === null) return;
    const view = viewOf(state, canSession);
    setState(write(view, name, value));
    setError(null);
    schedule(name, value, delay, view.target);
  }

  /** Removes every value in the layer a change goes to. */
  function resetAll(): void {
    if (state === null) return;
    const view = viewOf(state, canSession);
    let next = view;
    const names = Object.keys(view[view.target]);
    for (const name of names) next = write(next, name, null);
    setState(next);
    setError(null);
    for (const name of names) schedule(name, null, 0, view.target);
  }

  /** A preset is a change to this session, sent at once. */
  function choose(preset: TunePreset): void {
    if (state === null || !canSession) return;
    const applied = applyPreset(state, preset);
    setState(applied.state);
    setError(null);
    for (const name of Object.keys(applied.options)) {
      const old = timers.current.get(name);
      if (old !== undefined && old.target === "session") {
        clearTimeout(old.timer);
        timers.current.delete(name);
      }
    }
    enqueue(async () => {
      const result = await backendRef.current.setSession(applied.options);
      if (alone()) setState((open) => (open === null ? open : withSession(open, result.options)));
    });
    mirror();
  }

  /** The session's overrides become the model's saved values. */
  function keep(): void {
    if (state === null) return;
    const kept = keepSession(state);
    if (Object.keys(kept.save).length === 0) return;
    setState(kept.state);
    setError(null);
    enqueue(async () => {
      const saved = await backendRef.current.save(model, kept.save);
      const session = await backendRef.current.setSession(kept.clear);
      if (alone()) {
        setState((open) => (open === null ? open : withSession(withSaved(open, saved.model, saved.saved), session.options)));
      }
    });
  }

  /** Try again: ask the last question once more in a fork, with the values in use. */
  async function tryAgain(): Promise<void> {
    const again = backendRef.current.again;
    if (state === null || again === undefined || starting) return;
    const plan = again.plan(state);
    if (plan.kind === "refused") {
      setError(plan.notice);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await again.start(plan, tryHeading(state));
    } catch (failure) {
      setError(actionErrorText(failure, "Could not try again."));
    } finally {
      setStarting(false);
    }
  }

  // Leaving sends what is still waiting, so a change is never lost.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const waiting = timers.current;
    return () => {
      for (const [name, entry] of [...waiting]) {
        clearTimeout(entry.timer);
        waiting.delete(name);
        sendRef.current(entry, name);
      }
    };
  }, []);

  const view = state === null ? null : viewOf(state, canSession);
  const target = view?.target ?? "saved";
  const rows = view === null ? [] : tuneRows(view);
  const groups = groupRows(rows);
  const current = view === null ? null : activePreset(view);
  const layer = view === null ? {} : view[target];
  const names = Object.keys(layer);

  const again = canSession ? backend.again : undefined;
  let body;
  if (state === null || view === null) {
    body =
      error === null ? (
        <p role="status" className="px-3 py-6 text-center text-sm text-muted">
          Loading the options…
        </p>
      ) : (
        <div role="alert" className="flex flex-col items-center gap-3 px-3 py-6 text-center text-sm text-deny">
          <p>{error}</p>
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setReload((count) => count + 1);
            }}
          >
            Retry
          </Button>
        </div>
      );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Segmented
            label="Preset"
            wrap
            choices={PRESETS.map((preset) => ({ label: preset.label.charAt(0).toUpperCase() + preset.label.slice(1) }))}
            checked={current === null ? -1 : PRESETS.findIndex((preset) => preset.id === current.id)}
            disabled={!canSession}
            title={canSession ? undefined : "A preset is for the session that uses this model."}
            onPick={(index) => {
              const preset = PRESETS[index];
              if (preset !== undefined) choose(preset);
            }}
          />
          <span className="text-xs text-muted">{target === "session" ? "Changes apply to this session" : "Saved for this model"}</span>
        </div>
        {canSession ? (
          <div role="group" aria-label="Applies to" className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Applies to</span>
            <Button
              size="sm"
              kind={target === "saved" ? "ink" : "secondary"}
              aria-pressed={target === "saved"}
              onClick={() => target !== "saved" && setState(toggleTarget(view))}
            >
              Save for this model
            </Button>
            <Button
              size="sm"
              kind={target === "session" ? "ink" : "secondary"}
              aria-pressed={target === "session"}
              onClick={() => target !== "session" && setState(toggleTarget(view))}
            >
              This session only
            </Button>
          </div>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny">
            {error}
          </p>
        )}
        <div className="flex flex-col" aria-label={`Options of ${state.model}`} role="group">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`${ids}-group-${group.id}`}>
              <h3
                id={`${ids}-group-${group.id}`}
                className="mb-1 mt-4 border-b border-line pb-1 font-mono text-xs uppercase tracking-wider text-faint"
              >
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {group.rows.map((row) => {
                  const { option } = row;
                  const id = `${ids}-${option.name}`;
                  const fallbackNote = defaultNote(view, row);
                  const memory = memoryNote(view, row);
                  const changed = view[target][option.name] !== undefined;
                  const slider = !isListKind(option) && option.name !== "num_predict" && option.name !== "seed";
                  return (
                    <li
                      key={option.name}
                      title={option.short}
                      className={cn(
                        "flex flex-col gap-1 border-t border-dashed border-line py-2 first:border-t-0 transition-colors duration-700 motion-reduce:transition-none",
                        state.lit?.includes(option.name) && "bg-clay/25",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        {slider ? (
                          <label htmlFor={id} className="text-sm font-medium text-ink">
                            {option.label}
                          </label>
                        ) : (
                          <span className="text-sm font-medium text-ink">{option.label}</span>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`About ${option.label}`}
                              className="inline-grid size-4 place-items-center rounded-full border border-line-strong font-sans text-xs leading-none text-faint outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2"
                            >
                              i
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">
                            {option.long}
                            {memory?.warning === undefined ? null : <> {memory.warning}</>}
                          </TooltipContent>
                        </Tooltip>
                        {slider ? (
                          <span className={cn("ml-auto font-mono text-sm font-medium", differsFromDefault(view, row) ? "text-clay-ink" : "text-ink", row.value === null && "text-faint")}>
                            {formatTuneValue(option, row.value)}
                          </span>
                        ) : (
                          <span className="ml-auto" />
                        )}
                        {changed ? (
                          <IconButton label={`Reset ${option.label}`} className="size-6" onClick={() => change(option.name, null, 0)}>
                            <RefreshIcon width={14} height={14} />
                          </IconButton>
                        ) : (
                          <span aria-hidden="true" className="size-6 shrink-0" />
                        )}
                      </div>
                      <RowControl row={row} id={id} onChange={(value) => change(option.name, value, isListKind(option) ? 0 : TUNE_DEBOUNCE_MS)} />
                      <p className="text-xs text-muted">
                        {option.short}
                        {fallbackNote === null ? null : <span className="text-faint"> · {fallbackNote}</span>}
                        {memory === null ? null : <span className={FIT_CLASS[memory.fit]}> · {memory.text}</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        {again === undefined ? null : (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={again.blocked !== null || starting}
                title={again.blocked === "no-question" ? NO_QUESTION_NOTICE : again.blocked === "running" ? RUNNING_NOTICE : undefined}
                onClick={() => void tryAgain()}
              >
                Try again with these settings
              </Button>
              {again.blocked === null ? null : <span className="text-xs text-muted">{again.blocked === "running" ? RUNNING_NOTICE : NO_QUESTION_NOTICE}</span>}
            </div>
            {again.run === null ? null : <TryBlock run={again.run} onOpen={() => again.open(again.run?.sessionId ?? "")} />}
          </div>
        )}
      </>
    );
  }

  // Left goes back, except where it moves a slider or a list.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target;
    if (event.key !== "ArrowLeft" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    onBack();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-start gap-2">
        <button
          type="button"
          aria-label="Back to the models"
          onClick={onBack}
          className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-sm text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2"
        >
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h2 ref={heading} tabIndex={-1} aria-label={`Tune ${label}`} className="text-base font-semibold outline-none">
            {label}
          </h2>
          <p className="font-mono text-xs text-faint">{model}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">{body}</div>
      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button
          kind="ghost"
          aria-label="Reset all options"
          disabled={state === null || names.length === 0}
          title={target === "session" ? "Remove every override of this session." : "Remove every value saved for this model."}
          onClick={resetAll}
        >
          Reset all
        </Button>
        <span className="flex-1" />
        <span role="status" aria-live="polite" className="text-xs text-faint">
          {didSave ? "Saved ✓" : ""}
        </span>
        {canSession && state !== null && Object.keys(state.session).length > 0 ? (
          <Button kind="secondary" onClick={keep}>
            Save these for the model
          </Button>
        ) : null}
        <Button kind="ink" onClick={onBack}>
          Done
        </Button>
      </div>
    </div>
  );
}
