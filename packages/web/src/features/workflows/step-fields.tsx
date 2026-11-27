import { useId, useState, type ReactNode } from "react";
import type { WorkflowOutlineStep, WorkflowStepArg } from "../../store/workflows.ts";
import { Code } from "../../ui/code.tsx";
import { cn } from "../../ui/cn.ts";
import { fieldClass } from "../../ui/input.tsx";
import { suggestedKey } from "./text.ts";

/** The old wish words (`golem.agents.model.WISHES`). They still work in a file that has them, and are no longer offered. */
export const WISHES = ["cheapest", "same", "stronger", "local", "budget", "frontier"] as const;

type FieldKind = "text" | "area" | "agent" | "model" | "money" | "once";
type FieldSpec = { label: string; arg: string; kind: FieldKind };

/** `key=` is shown as a tick box: "Only once". */
const KEY: FieldSpec = { label: "Only once", arg: "key", kind: "once" };

/** The fields of each kind of step: the argument each one writes. A code step has none. */
export function fieldsOf(kind: string): readonly FieldSpec[] {
  if (kind === "agent") {
    return [
      { label: "brief", arg: "brief", kind: "area" },
      { label: "agent", arg: "type", kind: "agent" },
      { label: "model", arg: "model", kind: "model" },
      { label: "budget", arg: "budget", kind: "money" },
      KEY,
    ];
  }
  if (kind === "llm") return [{ label: "model", arg: "model", kind: "model" }, KEY];
  if (kind === "skill") return [{ label: "model", arg: "model", kind: "model" }, KEY];
  if (kind === "code") return [];
  return [KEY];
}

export type StepFieldsProps = {
  step: WorkflowOutlineStep;
  /** Sets one argument. Rejects with the reason it was refused. */
  onEdit: (name: string, value: string) => Promise<void>;
  /** The agent types to pick from. */
  agents?: readonly string[];
  /** The names of the models you have set up, as the chat's model picker shows them. */
  models?: readonly string[];
  /** Opens the agent file of a type. Without it, no link. */
  onOpenAgent?: (name: string) => void;
  /** Puts the caret on a line of the code, for a value the code computes. */
  onJump?: (line: number) => void;
  /** A field that was refused, to show its reason (the gallery and tests start here). */
  refused?: { name: string; message: string } | null;
};

function argOf(step: WorkflowOutlineStep, name: string): WorkflowStepArg | undefined {
  return (step.args ?? []).find((arg) => arg.name === name);
}

function Row({ label, id, children }: { label: string; id: string | null; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-16 shrink-0 pt-1 text-meta text-faint">
        {id === null ? label : <label htmlFor={id}>{label}</label>}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-col gap-1 wrap-anywhere">{children}</dd>
    </div>
  );
}

const small = "px-2 py-1 text-xs";

/**
 * What a model field says under it: which model the step would use, and when that model is not set up here, so.
 * Setting a model adds `model="…"` to the call; the step then uses it whatever the workflow's model is.
 */
export function modelNote(step: WorkflowOutlineStep, arg: WorkflowStepArg | undefined, busy: boolean): string {
  if (busy) return "Writing…";
  const now = step.model_now ?? null;
  const where = arg === undefined ? "" : ` Written on line ${arg.line}.`;
  if (now === null) return `No model is chosen, and golem has no default model yet.${where}`;
  if (step.model_ready === false) return `${now} is not set up on this machine, so this step would stop.${where}`;
  return arg === undefined ? `Uses ${now}: the workflow's model, else golem's default. Choosing one here writes it on this step.` : `Uses ${now}.${where}`;
}

function Control({ spec, step, value, id, busy, agents, models, onCommit }: { spec: FieldSpec; step: WorkflowOutlineStep; value: string | null; id: string; busy: boolean; agents: readonly string[]; models: readonly string[]; onCommit: (value: string) => void }) {
  const describedBy = `${id}-note`;
  if (spec.kind === "agent" || spec.kind === "model") {
    const options = spec.kind === "agent" ? agents : models;
    const extra = value !== null && !options.includes(value);
    return (
      <select
        id={id}
        aria-describedby={describedBy}
        className={cn(fieldClass, small)}
        value={value ?? ""}
        disabled={busy}
        onChange={(event) => {
          if (event.target.value !== "") onCommit(event.target.value);
        }}
      >
        {value === null ? <option value="">{spec.kind === "agent" ? "Choose…" : "the workflow's model"}</option> : null}
        {extra ? <option value={value}>{spec.kind === "model" && (WISHES as readonly string[]).includes(value) ? `${value} (old word)` : value}</option> : null}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    );
  }
  // Each field is written once, when you leave it or press Enter. A new value remounts it.
  const commit = (text: string) => {
    if (text !== (value ?? "")) onCommit(text);
  };
  const common = {
    id,
    "aria-describedby": describedBy,
    disabled: busy,
    defaultValue: value ?? "",
    placeholder: spec.kind === "money" ? "$0.50" : "not set",
    onBlur: (event: { currentTarget: { value: string } }) => commit(event.currentTarget.value),
  };
  const key = `${step.id}:${spec.arg}:${value ?? ""}`;
  if (spec.kind === "area") {
    return (
      <textarea
        key={key}
        rows={3}
        className={cn(fieldClass, small, "resize-y")}
        {...common}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit(event.currentTarget.value);
        }}
      />
    );
  }
  return (
    <input
      key={key}
      type="text"
      className={cn(fieldClass, small, spec.kind === "money" || spec.arg === "key" ? "field-literal" : undefined)}
      {...common}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value);
      }}
    />
  );
}

/**
 * `key=` as a tick box. Ticking a step with no key writes one made from its title. A key the code already has cannot be
 * taken out from here (the daemon sets arguments, it does not remove them), and a step that repeats needs a key for each
 * round, which only the code can say: both point to the code.
 */
function OnceBox({ step, arg, id, busy, error, onSet, onJump }: { step: WorkflowOutlineStep; arg: WorkflowStepArg | undefined; id: string; busy: boolean; error: string | null; onSet: (value: string) => void; onJump?: (line: number) => void }) {
  const on = arg !== undefined;
  const repeats = !on && Boolean(step.for_each);
  const hint = on ? `key=${arg.source}` : repeats ? "key=f\"…{item}\"" : `key="${suggestedKey(step)}"`;
  return (
    <>
      <span className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          aria-describedby={`${id}-note`}
          checked={on}
          disabled={busy || on || repeats}
          onChange={() => onSet(suggestedKey(step))}
          className="mt-1 accent-clay"
        />
        <span className="min-w-0">
          If the run stops and starts again, this step is not done a second time.
          <span className="block text-meta text-faint">
            In the code: <Code tone="muted">{hint}</Code>
          </span>
        </span>
      </span>
      <span id={`${id}-note`} className={cn("text-meta wrap-anywhere", error === null ? "text-faint" : "text-deny")} role={error === null ? undefined : "alert"}>
        {error ??
          (busy
            ? "Writing…"
            : repeats
              ? "This step repeats, so each round needs its own key. Write it in the code."
              : on
                ? `To turn it off, take key out of line ${arg.line} of the code.`
                : "Not written in the code. Ticking it adds it.")}
        {on && onJump !== undefined ? (
          <>
            {" "}
            <button type="button" onClick={() => onJump(arg.line)} aria-label={`Show key in code, line ${arg.line}`} className="text-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
              show ↗
            </button>
          </>
        ) : null}
      </span>
    </>
  );
}

/**
 * The fields of the selected step (mock § B). Each one is one argument of the step's call: changing it writes exactly
 * that argument in the code, and nothing else. A value the code computes is shown as its source, "set in code".
 */
export function StepFields({ step, onEdit, agents = [], models = [], onOpenAgent, onJump, refused = null }: StepFieldsProps) {
  const base = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ name: string; message: string } | null>(refused);
  const specs = fieldsOf(step.kind);
  if (specs.length === 0) return <p className="text-meta text-faint">A code step has no fields to edit here. Its function opens in the code pane.</p>;

  async function commit(name: string, value: string): Promise<void> {
    setBusy(name);
    setError(null);
    try {
      await onEdit(name, value);
    } catch (reason) {
      setError({ name, message: reason instanceof Error && reason.message !== "" ? reason.message : "The field was not changed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <dl aria-label="Fields of the step" className="flex flex-col gap-2">
      {specs.map((spec) => {
        const arg = argOf(step, spec.arg);
        const id = `${base}-${spec.arg}`;
        const mine = error !== null && error.name === spec.arg ? error.message : null;
        const computed = arg !== undefined && !arg.literal;
        if (spec.kind === "once") {
          return (
            <Row key={spec.arg} label={spec.label} id={id}>
              <OnceBox step={step} arg={arg} id={id} busy={busy === spec.arg} error={mine} onSet={(value) => void commit(spec.arg, value)} onJump={onJump} />
            </Row>
          );
        }
        return (
          <Row key={spec.arg} label={spec.label} id={computed ? null : id}>
            {computed ? (
              <>
                <Code tone="muted" className="block max-h-24 overflow-auto rounded-md border border-line bg-surface px-2 py-1 whitespace-pre-wrap">
                  {arg.source}
                </Code>
                <span id={`${id}-note`} className="flex items-baseline gap-1 text-meta text-faint">
                  <span>The code computes this, so it is set in code.</span>
                  {onJump === undefined ? null : (
                    <button type="button" onClick={() => onJump(arg.line)} aria-label={`Set ${spec.label} in code, line ${arg.line}`} className="shrink-0 text-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
                      set in code ↗
                    </button>
                  )}
                </span>
              </>
            ) : (
              <>
                <Control spec={spec} step={step} id={id} value={arg === undefined ? null : (arg.value ?? arg.source)} busy={busy === spec.arg} agents={agents} models={models} onCommit={(value) => void commit(spec.arg, value)} />
                <span id={`${id}-note`} className={cn("text-meta wrap-anywhere", mine === null ? "text-faint" : "text-deny")} role={mine === null ? undefined : "alert"}>
                  {mine ?? (spec.kind === "model" ? modelNote(step, arg, busy === spec.arg) : arg === undefined ? "Not written in the code. Setting it adds it." : busy === spec.arg ? "Writing…" : `Writes line ${arg.line} of the code.`)}
                </span>
              </>
            )}
            {spec.kind === "agent" && onOpenAgent !== undefined && arg !== undefined && arg.literal && arg.value ? (
              <button type="button" onClick={() => onOpenAgent(arg.value ?? "")} className="self-start text-meta text-muted underline underline-offset-2 outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2">
                {`agents/${arg.value}.md ↗`}
              </button>
            ) : null}
          </Row>
        );
      })}
    </dl>
  );
}
