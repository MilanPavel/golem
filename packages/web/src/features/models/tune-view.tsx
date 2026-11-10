import type { ModelOptionsGetResult, ModelOptionsSetResult, SessionSetOptionsResult } from "../../store/model-options.ts";
import {
  applyPreset,
  defaultNote,
  formatTuneValue,
  NUM_CTX_START,
  keepSession,
  KEEP_ALIVE_STEPS,
  memoryNote,
  PRESETS,
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
} from "@golem/view";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { ChevronLeftIcon } from "../../ui/icons.tsx";
import { cn } from "../../ui/cn.ts";

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

function RowControl({ row, id, onChange }: { row: TuneRow; id: string; onChange: (value: TuneValue) => void }) {
  const { option, value } = row;
  if (option.kind === "duration") {
    const current = value === null ? "" : String(value);
    const known = KEEP_ALIVE_STEPS.map(String);
    return (
      <select
        id={id}
        value={current}
        onChange={(event) => {
          const picked = KEEP_ALIVE_STEPS.find((step) => String(step) === event.target.value);
          onChange(picked ?? event.target.value);
        }}
        className="min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {current === "" ? <option value="">default</option> : null}
        {known.includes(current) || current === "" ? null : <option value={current}>{current}</option>}
        {known.map((step) => (
          <option key={step} value={step}>
            {KEEP_ALIVE_LABELS.get(step) ?? step}
          </option>
        ))}
      </select>
    );
  }
  // `num_ctx` with no default and no value: no thumb, and the first move starts at NUM_CTX_START.
  const unset = option.name === "num_ctx" && value === null;
  return (
    <input
      id={id}
      type="range"
      min={option.minimum}
      max={option.maximum}
      step={option.step}
      value={typeof value === "number" ? value : unset ? NUM_CTX_START : option.minimum}
      onChange={(event) => onChange(unset ? NUM_CTX_START : event.target.valueAsNumber)}
      className={cn(
        "min-w-0 flex-1 accent-clay",
        unset && "[&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-thumb]:opacity-0",
      )}
    />
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
  const [shown, setShown] = useState<string | null>(null);
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
    mirror();
    queue.current = queue.current.then(async () => {
      try {
        await job();
      } catch (failure) {
        setError(actionErrorText(failure, "Could not change the option."));
        setReload((count) => count + 1);
      } finally {
        inflight.current -= 1;
        mirror();
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
  const explained = rows.find((row) => row.option.name === shown) ?? rows[0];
  const layer = view === null ? {} : view[target];
  const names = Object.keys(layer);

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
    const explainedNote = explained === undefined ? null : memoryNote(view, explained);
    body = (
      <>
        <div role="group" aria-label="Presets" className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              disabled={!canSession}
              title={canSession ? undefined : "A preset is for the session that uses this model."}
              onClick={() => choose(preset)}
            >
              {preset.label.charAt(0).toUpperCase() + preset.label.slice(1)}
            </Button>
          ))}
          {canSession && Object.keys(state.session).length > 0 ? (
            <Button size="sm" kind="ghost" onClick={keep}>
              Save these for the model
            </Button>
          ) : null}
        </div>
        {state.preset === undefined ? null : (
          <p role="status" className="text-xs text-muted">
            Preset {state.preset} · this session
          </p>
        )}
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
        ) : (
          <p className="text-sm text-muted">Every change is saved for this model.</p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2" aria-label={`Options of ${state.model}`}>
          {rows.map((row) => {
            const { option } = row;
            const id = `${ids}-${option.name}`;
            const fallbackNote = defaultNote(view, row);
            const memory = memoryNote(view, row);
            return (
              <li
                key={option.name}
                title={option.short}
                onFocusCapture={() => setShown(option.name)}
                onMouseEnter={() => setShown(option.name)}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 transition-colors duration-700 motion-reduce:transition-none",
                  state.lit?.includes(option.name) ? "bg-clay/25" : explained?.option.name === option.name && "bg-line/40",
                )}
              >
                <label htmlFor={id} className="w-28 shrink-0 text-sm text-ink">
                  {option.label}
                </label>
                <div className="flex min-w-40 flex-1 items-center">
                  <RowControl row={row} id={id} onChange={(value) => change(option.name, value, option.kind === "duration" ? 0 : TUNE_DEBOUNCE_MS)} />
                </div>
                <span className="w-16 text-right font-mono text-sm text-ink">{formatTuneValue(option, row.value)}</span>
                <span className="flex w-44 flex-col text-xs text-muted">
                  {memory === null ? null : <span className={FIT_CLASS[memory.fit]}>{memory.text}</span>}
                  {fallbackNote === null ? null : <span>{fallbackNote}</span>}
                </span>
                <Button
                  size="sm"
                  kind="ghost"
                  aria-label={`Reset ${option.label}`}
                  disabled={view[target][option.name] === undefined}
                  onClick={() => change(option.name, null, 0)}
                >
                  Reset
                </Button>
              </li>
            );
          })}
        </ul>
        {explained === undefined ? null : (
          <p className="min-h-12 text-sm text-muted">
            <span className="font-medium text-ink">{explained.option.label}.</span> {explained.option.long}
            {explainedNote?.warning === undefined ? null : <> {explainedNote.warning}</>}
          </p>
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
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Back to the models"
          onClick={onBack}
          className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-sm text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2"
        >
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h2 ref={heading} tabIndex={-1} aria-label={`Tune ${label}`} className="text-base font-semibold outline-offset-2 outline-clay focus-visible:outline-2">
            {label}
          </h2>
          <p className="font-mono text-xs text-faint">{model}</p>
        </div>
      </div>
      {body}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-4">
        <Button
          kind="secondary"
          aria-label="Reset all options"
          disabled={state === null || names.length === 0}
          title={target === "session" ? "Remove every override of this session." : "Remove every value saved for this model."}
          onClick={resetAll}
        >
          Reset
        </Button>
        <Button kind="ink" onClick={onBack}>
          Done
        </Button>
      </div>
    </div>
  );
}
