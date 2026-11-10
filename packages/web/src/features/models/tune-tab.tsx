import type { ModelOptionsGetResult, ModelOptionsSetResult, SessionSetOptionsResult } from "../../store/model-options.ts";
import {
  differsFromDefault,
  formatTuneValue,
  KEEP_ALIVE_STEPS,
  toggleTarget,
  tuneRows,
  tuneState,
  withSaved,
  withSession,
  type TuneRow,
  type TuneState,
  type TuneTarget,
  type TuneValue,
} from "@golem/view";
import { useEffect, useId, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";

/** What the Tune tab needs of the page, with the session already bound. */
export type TuneBackend = {
  /** The session a change can be limited to, or null when the dialog has none. */
  sessionId: string | null;
  /** The model's options, with the session's overrides when there is one. */
  load(model: string): Promise<ModelOptionsGetResult>;
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

type Pending = { timer: ReturnType<typeof setTimeout>; model: string; target: TuneTarget; value: TuneValue | null };

/** Writes one value into the layer a change goes to, or removes it with null. */
function write(state: TuneState, name: string, value: TuneValue | null): TuneState {
  const layer: Record<string, TuneValue> = { ...state[state.target] };
  if (value === null) delete layer[name];
  else layer[name] = value;
  return state.target === "saved" ? withSaved(state, state.model, layer) : withSession(state, layer);
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
  return (
    <input
      id={id}
      type="range"
      min={option.minimum}
      max={option.maximum}
      step={option.step}
      value={typeof value === "number" ? value : option.minimum}
      onChange={(event) => onChange(event.target.valueAsNumber)}
      className="min-w-0 flex-1 accent-clay"
    />
  );
}

/**
 * The options of a local model, one row each, with the same explanations as `/tune` in the terminal.
 * A change shows at once and is sent after the debounce: into `config.toml` for the model, or into
 * this session only. What another client changes shows here as soon as it arrives.
 */
export function TuneTab({ model, backend }: { model: string; backend: TuneBackend }) {
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
  useEffect(() => {
    backendRef.current = backend;
  });
  const canSession = backend.sessionId !== null;
  const settled = () => timers.current.size === 0 && inflight.current === 0;
  const mirror = () => setBusy(timers.current.size + inflight.current);

  useEffect(() => {
    let current = true;
    backendRef.current.load(model).then(
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

  function send(entry: Pending, name: string): void {
    inflight.current += 1;
    mirror();
    queue.current = queue.current.then(async () => {
      try {
        if (entry.target === "saved") {
          const result = await backendRef.current.save(entry.model, { [name]: entry.value });
          if (timers.current.size === 0 && inflight.current === 1) setState((open) => (open === null ? open : withSaved(open, result.model, result.saved)));
        } else {
          const result = await backendRef.current.setSession({ [name]: entry.value });
          if (timers.current.size === 0 && inflight.current === 1) setState((open) => (open === null ? open : withSession(open, result.options)));
        }
      } catch (failure) {
        setError(actionErrorText(failure, "Could not change the option."));
        setReload((count) => count + 1);
      } finally {
        inflight.current -= 1;
        mirror();
      }
    });
  }

  function change(name: string, value: TuneValue | null, delay: number): void {
    if (state === null) return;
    const view = viewOf(state, canSession);
    setState(write(view, name, value));
    setError(null);
    const old = timers.current.get(name);
    if (old !== undefined) clearTimeout(old.timer);
    const entry = { model, target: view.target, value } as Pending;
    const fire = () => {
      timers.current.delete(name);
      send(entry, name);
    };
    entry.timer = setTimeout(fire, delay);
    timers.current.set(name, entry);
    mirror();
  }

  // Closing the tab sends what is still waiting, so a change is never lost.
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

  if (state === null) {
    return error === null ? (
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
  }

  const view = viewOf(state, canSession);
  const target = view.target;
  const rows = tuneRows(view);
  const explained = rows.find((row) => row.option.name === shown) ?? rows[0];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Where a change goes" className="flex flex-wrap gap-2">
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
          disabled={!canSession}
          title={canSession ? undefined : "This model is not the one this session uses."}
          onClick={() => target !== "session" && setState(toggleTarget(view))}
        >
          This session only
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2" aria-label={`Options of ${state.model}`}>
        {rows.map((row) => {
          const { option } = row;
          const id = `${ids}-${option.name}`;
          const differs = differsFromDefault(view, row);
          const fallback = state.defaults[option.name];
          return (
            <li
              key={option.name}
              title={option.short}
              onFocusCapture={() => setShown(option.name)}
              onMouseEnter={() => setShown(option.name)}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1",
                explained?.option.name === option.name && "bg-line/40",
              )}
            >
              <label htmlFor={id} className="w-28 shrink-0 text-sm text-ink">
                {option.label}
              </label>
              <div className="flex min-w-40 flex-1 items-center">
                <RowControl row={row} id={id} onChange={(value) => change(option.name, value, option.kind === "duration" ? 0 : TUNE_DEBOUNCE_MS)} />
              </div>
              <span className="w-16 text-right font-mono text-sm text-ink">{formatTuneValue(option, row.value)}</span>
              <span className="w-36 text-xs text-muted">
                {differs && fallback !== undefined ? `model default ${formatTuneValue(option, fallback)}` : ""}
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
        </p>
      )}
    </div>
  );
}
