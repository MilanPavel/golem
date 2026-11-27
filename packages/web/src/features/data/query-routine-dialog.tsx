import { useId, useState } from "react";
import {
  DEFAULT_WHEN,
  QUERY_ROUTINE_PRIVACY,
  QUERY_THEN,
  QUERY_WHEN_KINDS,
  queryRoutineFields,
  routineNameOf,
  routineToml,
  watchOfLocation,
  WEEK_DAYS,
  whenOfQuery,
  type QueryThen,
  type QueryWhenKind,
  type RoutineConfigLike,
} from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { fieldClass, Input } from "../../ui/input.tsx";

/** What the dialog needs of the source: its name, its kind and where it reads (a files source can watch its folder). */
export type QueryRoutineSource = { name: string; kind: string; location?: string | null | undefined };

/** What Create hands over: the routine's name and the fields `routine.update` takes. */
export type QueryRoutineCreate = { name: string; fields: Partial<RoutineConfigLike>; summary: boolean };

export type QueryRoutineFormProps = {
  source: QueryRoutineSource;
  saved: string;
  /** The names of the routines that exist, so a new name does not clash. */
  taken?: readonly string[];
  /** Writes the routine. Rejects with the daemon's reason. */
  onCreate: (create: QueryRoutineCreate) => Promise<unknown>;
  onClose: () => void;
  inline?: boolean;
  initial?: { when?: QueryWhenKind; then?: QueryThen; error?: string | null };
};

function freeName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base.slice(0, 36)}-${String(n)}`;
    if (!taken.includes(next)) return next;
  }
}

/**
 * The Routine dialog of a saved query: When it runs, and Then what it does (post the result, post only rows, or have
 * a model write a summary). It writes a routine that runs the query with no model, or the data report workflow.
 */
export function QueryRoutineForm({ source, saved, taken = [], onCreate, onClose, inline = false, initial }: QueryRoutineFormProps) {
  const ids = useId();
  const watch = source.kind === "files" ? watchOfLocation(source.location) : null;
  const whens = QUERY_WHEN_KINDS.filter((each) => each.kind !== "watch" || watch !== null);
  const [kind, setKind] = useState<QueryWhenKind>(initial?.when ?? "hour");
  const [time, setTime] = useState(DEFAULT_WHEN.time);
  const [day, setDay] = useState(DEFAULT_WHEN.day);
  const [cron, setCron] = useState("");
  const [then, setThen] = useState<QueryThen>(initial?.then ?? "rows");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const name = freeName(routineNameOf(saved), taken);
  const fields = queryRoutineFields({
    source: source.name,
    saved,
    when: whenOfQuery(kind, time, day, cron),
    then,
    ...(watch === null ? {} : { folder: watch.folder, glob: watch.glob }),
  });
  const preview = fields === null ? null : routineToml({ name, ...fields });

  function create(): void {
    if (fields === null) {
      setError(kind === "cron" ? "Type a cron line, such as 0 8 * * 1." : "Type a time of day, such as 08:30.");
      return;
    }
    setError(null);
    setBusy(true);
    onCreate({ name, fields, summary: then === "summary" }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (failed: unknown) => {
        setBusy(false);
        setError(failed instanceof Error ? failed.message : "The routine could not be saved.");
      },
    );
  }

  const heading = `New routine for "${saved}"`;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) create();
      }}
    >
      {inline ? <h2 className="text-base font-semibold">{heading}</h2> : <DialogTitle>{heading}</DialogTitle>}
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-when`} className="text-sm text-muted">
            When
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select id={`${ids}-when`} className={cn(fieldClass, "w-auto min-w-0 max-w-full")} value={kind} onChange={(event) => setKind(event.target.value as QueryWhenKind)}>
              {whens.map((each) => (
                <option key={each.kind} value={each.kind}>
                  {each.label}
                </option>
              ))}
            </select>
            {kind === "daily" || kind === "weekdays" || kind === "weekly" ? (
              <>
                {kind === "weekly" ? (
                  <select aria-label="Day" className={cn(fieldClass, "w-auto")} value={day} onChange={(event) => setDay(Number(event.target.value))}>
                    {WEEK_DAYS.map((each) => (
                      <option key={each.day} value={each.day}>
                        {each.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Input aria-label="Time" className="w-24" value={time} placeholder="08:30" onChange={(event) => setTime(event.target.value)} />
              </>
            ) : null}
            {kind === "cron" ? <Input aria-label="Cron" className="w-44 font-mono" value={cron} placeholder="0 8 * * 1" onChange={(event) => setCron(event.target.value)} /> : null}
          </div>
          {kind === "watch" && watch !== null ? (
            <p className="text-meta text-faint">
              Runs for each new {watch.glob === "*" ? "file" : <Code>{watch.glob}</Code>} in <Code>{watch.folder}</Code>.
            </p>
          ) : null}
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm text-muted">Then</legend>
          {QUERY_THEN.map((choice) => (
            <label key={choice.value} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm", then === choice.value ? "border-clay bg-clay-soft" : "border-line")}>
              <input type="radio" name={`${ids}-then`} className="mt-1" checked={then === choice.value} onChange={() => setThen(choice.value)} />
              <span>
                {choice.label}
                <small className="block text-meta text-muted">{choice.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-meta text-faint">{QUERY_ROUTINE_PRIVACY}</p>
        {preview === null ? null : (
          <details className="text-meta text-muted">
            <summary className="cursor-pointer">What it writes to config.toml</summary>
            <pre tabIndex={0} aria-label="The routine as written" className="mt-1 overflow-auto rounded-md border border-line bg-sunken p-2.5 font-mono text-code leading-relaxed text-ink-soft outline-offset-2 outline-clay focus-visible:outline-2">
              {preview}
            </pre>
          </details>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" kind="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create routine"}
        </Button>
      </div>
    </form>
  );
}

/** The ⏱ Routine dialog. It forgets what was picked when it closes. */
export function QueryRoutineDialog({ open, ...form }: QueryRoutineFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onClose())}>
      <DialogContent className="max-w-lg">
        <DialogDescription className="sr-only">Run {form.saved} on a schedule and post what it finds to the Inbox.</DialogDescription>
        <QueryRoutineForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
