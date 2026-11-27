import { useId, useState, type ReactNode } from "react";
import {
  ADD_KINDS,
  ADD_STEPS,
  DATA_PRIVACIES,
  FILES_PATH_EXAMPLE,
  inspectSummary,
  PASSWORD_NOTE,
  PRIVACY_SHORT,
  stepName,
  type AddKind,
  type AddStep,
  type DataPrivacy,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { AddKindIcon } from "../../ui/data-icons.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Input } from "../../ui/input.tsx";
import { dataErrorText, type DataAddParams, type DataExtensionName, type DataInspectResult, type DataSource } from "../../store/data.ts";
import { folderName } from "../sessions/folder.ts";
import { ExtensionRow } from "./extension-row.tsx";
import { PrivacyChip } from "./privacy-chip.tsx";
import { RowsTable } from "./rows-table.tsx";

type DbType = "postgres" | "mysql" | "sqlite";
type Scope = "user" | "project";

/** What a check of the location came to. `location` is the text that was checked, so a result is not shown for another. */
type Check = { state: "idle" } | { state: "checking"; location: string } | { state: "ok"; location: string; result: DataInspectResult } | { state: "error"; location: string; message: string };

/** The state a form can open in. For the gallery and tests; a person never sets it. */
export type AddFormInitial = {
  step?: AddStep;
  kind?: AddKind;
  path?: string;
  address?: string;
  dbType?: DbType;
  scope?: Scope;
  name?: string;
  privacy?: DataPrivacy;
  check?: Check;
  error?: string | null;
};

export type AddFormProps = {
  /** The folder of the chat in view, for "this project". Null when there is none. */
  folder: string | null;
  /** Looks at a location. Rejects with the daemon's reason. */
  onInspect: (location: string) => Promise<DataInspectResult>;
  /** Downloads an add-on the location needs. Rejects with the reason. Without it the dialog only says the add-on is missing. */
  onInstallExtension?: (name: DataExtensionName) => Promise<void>;
  /** Adds the source. Rejects with the daemon's reason. */
  onAdd: (params: DataAddParams) => Promise<DataSource>;
  /** The source was added: open its page. */
  onAdded: (source: DataSource) => void;
  onCancel: () => void;
  /** Opens Settings › MCP servers. */
  onOpenMcp: () => void;
  /** The gallery shows the form on the page, outside a dialog: the title is then a plain heading. */
  inline?: boolean;
  initial?: AddFormInitial;
};

/** A name for a source from where it is: `~/Documents/bank/*.csv` is `bank`, `postgres://u@h/shop_dev` is `shop_dev`. */
export function nameFromLocation(location: string): string {
  const cleaned = location.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter((part) => part !== "" && !part.includes("*"));
  const last = parts.at(-1) ?? "";
  const stem = last.replace(/\.[A-Za-z0-9]+$/, "");
  const name = stem.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return name === "" ? "source" : name;
}

function Field({ label, htmlFor, children, note }: { label: string; htmlFor?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <label htmlFor={htmlFor} className="w-24 shrink-0 pt-2 text-sm text-faint">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {note === undefined ? null : <p className="text-meta text-muted">{note}</p>}
      </div>
    </div>
  );
}

function Choice({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left outline-offset-2 outline-clay focus-visible:outline-2",
        on ? "border-clay bg-clay-soft" : "border-line bg-surface hover:border-line-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Found({ check }: { check: Check }) {
  if (check.state === "idle") return null;
  if (check.state === "checking") return <p className="text-sm text-muted">Reading the headers and a few sample rows…</p>;
  if (check.state === "error") return null;
  const first = check.result.tables[0];
  const rows = first === undefined ? [] : (check.result.sample[first.name] ?? []);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
      <p className="text-sm">
        <span aria-hidden="true" className="text-allow">
          ✓{" "}
        </span>
        {inspectSummary(check.result)}
      </p>
      {first !== undefined && rows.length > 0 ? <RowsTable columns={first.columns ?? []} rows={rows} limit={3} label={`Sample rows of ${first.name}`} /> : null}
      {check.result.notes !== undefined && check.result.notes.length > 0 ? (
        <ul aria-label="What golem guessed" className="list-disc pl-5 text-meta text-muted">
          {check.result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The three steps of Add a source: what kind, where it is, who may see rows. Nothing is saved until Add source. */
export function AddForm({ folder, onInspect, onInstallExtension, onAdd, onAdded, onCancel, onOpenMcp, inline = false, initial }: AddFormProps) {
  const ids = useId();
  const [step, setStep] = useState<AddStep>(initial?.step ?? "kind");
  const [kind, setKind] = useState<AddKind>(initial?.kind ?? "files");
  const [path, setPath] = useState(initial?.path ?? "");
  const [url, setUrl] = useState("");
  const [dbType, setDbType] = useState<DbType>(initial?.dbType ?? "postgres");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState<Scope>(initial?.scope ?? (folder !== null && initial?.kind === "database" ? "project" : "user"));
  const [check, setCheck] = useState<Check>(initial?.check ?? { state: "idle" });
  const [hint, setHint] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string | null>(initial?.name ?? null);
  const [chosenPrivacy, setChosenPrivacy] = useState<DataPrivacy | null>(initial?.privacy ?? null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);

  const location = (kind === "files" ? path : kind === "url" ? url : address).trim();
  const result = check.state === "ok" && check.location === location ? check.result : null;
  const failure = check.state === "error" && check.location === location ? check.message : null;
  const name = typedName ?? result?.suggested_name ?? nameFromLocation(location);
  const privacy = chosenPrivacy ?? result?.suggested_privacy ?? "local";
  const deviceKind = kind === "database" ? dbType : (result?.kind ?? (kind === "url" ? "url" : "files"));

  function inspect(): Promise<void> {
    if (location === "") {
      setHint(kind === "database" ? "Type the address of the database first." : kind === "url" ? "Type the web address first." : "Type where the files are first.");
      return Promise.resolve();
    }
    setHint(null);
    setCheck({ state: "checking", location });
    return onInspect(location).then(
      (found) => setCheck({ state: "ok", location, result: found }),
      (failed: unknown) => setCheck({ state: "error", location, message: dataErrorText(failed, "Could not read that.") }),
    );
  }

  async function next(): Promise<void> {
    if (step === "kind") {
      setHint(null);
      setStep("where");
      return;
    }
    if (step === "where") {
      if (location === "") {
        setHint(kind === "database" ? "Type the address of the database first." : kind === "url" ? "Type the web address first." : "Type where the files are first.");
        return;
      }
      // A problem found now does not stop the person: Add source reports the real one.
      if (result === null && failure === null) await inspect();
      setStep("privacy");
    }
  }

  function add(): void {
    setError(null);
    setAdding(true);
    const params: DataAddParams = {
      name: name.trim() === "" ? nameFromLocation(location) : name.trim(),
      location,
      kind: deviceKind,
      privacy,
      scope,
      watch: kind === "files" && !location.startsWith("http"),
    };
    if (kind === "database" && dbType !== "sqlite" && password !== "") params.password = password;
    onAdd(params).then(
      (source) => {
        // The password is gone from the form once it has gone to the daemon.
        setPassword("");
        setAdding(false);
        onAdded(source);
      },
      (failed: unknown) => {
        setError(dataErrorText(failed, "Could not add the source."));
        setAdding(false);
      },
    );
  }

  const title = inline ? <h2 className="text-base font-semibold">Add a source</h2> : <DialogTitle>Add a source</DialogTitle>;
  const stepper = (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-2 text-meta text-faint">
      {ADD_STEPS.map((each, at) => (
        <li key={each} aria-current={each === step ? "step" : undefined} className={cn(each === step && "text-ink")}>
          {stepName(each)}
          {at < ADD_STEPS.length - 1 ? <span aria-hidden="true"> ›</span> : null}
        </li>
      ))}
    </ol>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (adding) return;
        if (step === "privacy") add();
        else if (!(step === "kind" && kind === "mcp")) void next();
      }}
    >
      <div className="flex flex-col gap-1">
        {title}
        {inline ? null : <DialogDescription>Pick what it is, say where it is, then say who may see its rows. golem reads it in place and never writes to it.</DialogDescription>}
        {stepper}
      </div>

      {step === "kind" ? (
        <div className="mt-4 flex flex-col gap-3">
          <div role="radiogroup" aria-label="What kind of source" className="grid grid-cols-2 gap-2">
            {ADD_KINDS.map((option) => (
              <Choice key={option.kind} on={kind === option.kind} onClick={() => setKind(option.kind)}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <AddKindIcon kind={option.kind} className="shrink-0 text-muted" />
                  {option.title}
                </span>
                <span className="mt-1 block text-meta text-muted">{option.detail}</span>
              </Choice>
            ))}
          </div>
          {kind === "mcp" ? (
            <p className="text-sm text-muted">An MCP server is set up in Settings, not here. It adds tools, so there is no privacy choice to make.</p>
          ) : (
            <p className="text-meta text-faint">You can also drop a file on a chat. golem asks whether to add it as a source.</p>
          )}
        </div>
      ) : null}

      {step === "where" ? (
        <div className="mt-4 flex flex-col gap-3">
          {kind === "database" ? (
            <>
              <Field label="Type" htmlFor={`${ids}-type`}>
                <select
                  id={`${ids}-type`}
                  value={dbType}
                  onChange={(event) => setDbType(event.target.value as DbType)}
                  className="w-44 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="sqlite">SQLite file</option>
                </select>
              </Field>
              <Field label="Address" htmlFor={`${ids}-address`}>
                <Input
                  id={`${ids}-address`}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={dbType === "sqlite" ? "~/data/shop.db" : "postgres://reader@localhost:5432/shop"}
                  aria-invalid={failure !== null}
                  aria-describedby={failure === null ? undefined : `${ids}-failure`}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
              {dbType === "sqlite" ? null : (
                <Field label="Password" htmlFor={`${ids}-password`} note={PASSWORD_NOTE}>
                  <Input id={`${ids}-password`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="w-64" />
                </Field>
              )}
            </>
          ) : (
            <Field label={kind === "url" ? "Address" : "Path"} htmlFor={`${ids}-path`} note={kind === "files" ? `A folder, a file, or a pattern such as ${FILES_PATH_EXAMPLE}` : "A CSV or Parquet file on the web."}>
              <Input
                id={`${ids}-path`}
                value={kind === "url" ? url : path}
                onChange={(event) => (kind === "url" ? setUrl(event.target.value) : setPath(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void inspect();
                  }
                }}
                placeholder={kind === "url" ? "https://example.com/data.csv" : FILES_PATH_EXAMPLE}
                aria-invalid={failure !== null}
                aria-describedby={failure === null ? undefined : `${ids}-failure`}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}
          {folder === null ? null : (
            <Field label="Save in">
              <div role="radiogroup" aria-label="Save in" className="flex flex-wrap gap-2">
                <Choice on={scope === "project"} onClick={() => setScope("project")} className="px-3 py-1.5">
                  <span className="text-sm">this project · {folderName(folder)}</span>
                </Choice>
                <Choice on={scope === "user"} onClick={() => setScope("user")} className="px-3 py-1.5">
                  <span className="text-sm">yours, every chat</span>
                </Choice>
              </div>
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={check.state === "checking"} onClick={() => void inspect()}>
              {kind === "database" ? "Test connection" : "Check"}
            </Button>
            {kind === "database" ? <span className="text-meta text-faint">golem connects from the daemon. The shell and the model never see the address or the password.</span> : null}
          </div>
          {hint === null ? null : (
            <p role="status" className="text-sm text-wait">
              {hint}
            </p>
          )}
          {failure === null ? null : (
            <p id={`${ids}-failure`} role="alert" className="text-sm text-deny wrap-anywhere">
              {failure}
            </p>
          )}
          <div aria-live="polite">
            <Found check={result !== null || check.state === "checking" ? check : { state: "idle" }} />
          </div>
          {result?.needs_extension != null && onInstallExtension !== undefined ? <ExtensionRow name={result.needs_extension} onInstall={onInstallExtension} onDone={() => void inspect()} /> : null}
          {failure !== null ? <p className="text-meta text-muted">You can still go on. Adding the source shows the real error if there is one.</p> : null}
        </div>
      ) : null}

      {step === "privacy" ? (
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Name" htmlFor={`${ids}-name`} note={<>the model calls it by this name: @{name}</>}>
            <Input id={`${ids}-name`} value={name} onChange={(event) => setTypedName(event.target.value)} spellCheck={false} autoComplete="off" className="w-56 font-mono" />
          </Field>
          <div className="flex flex-col gap-2">
            <h3 className="text-meta font-medium text-faint">Who may see rows</h3>
            <div role="radiogroup" aria-label="Who may see rows" className="flex flex-col gap-2">
              {DATA_PRIVACIES.map((level) => (
                <Choice key={level} on={privacy === level} onClick={() => setChosenPrivacy(level)} className="flex items-center gap-3 p-2.5">
                  <PrivacyChip privacy={level} />
                  <span className="text-sm text-muted">{PRIVACY_SHORT[level]}</span>
                  {result?.suggested_privacy === level ? <span className="ml-auto text-meta text-clay-ink">suggested</span> : null}
                </Choice>
              ))}
            </div>
            {result?.privacy_reason === null || result?.privacy_reason === undefined ? null : <p className="text-meta text-muted">Suggested because: {result.privacy_reason}</p>}
          </div>
          {error === null ? null : (
            <p role="alert" className="rounded-md border border-deny bg-deny-soft px-3 py-2 text-sm text-deny wrap-anywhere">
              {error}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {step === "kind" ? null : (
          <Button
            onClick={() => {
              setHint(null);
              setError(null);
              setStep(step === "privacy" ? "where" : "kind");
            }}
          >
            Back
          </Button>
        )}
        {step === "kind" && kind === "mcp" ? (
          <Button kind="primary" onClick={onOpenMcp}>
            Open MCP servers
          </Button>
        ) : step === "privacy" ? (
          <Button kind="primary" type="submit" disabled={adding}>
            {adding ? "Adding…" : "Add source"}
          </Button>
        ) : (
          <Button kind="primary" type="submit" disabled={check.state === "checking"}>
            Next
          </Button>
        )}
      </div>
    </form>
  );
}

export type AddDialogProps = Omit<AddFormProps, "initial" | "inline"> & { open: boolean };

/** The Add a source dialog. It forgets what was typed when it closes. */
export function AddDialog({ open, ...form }: AddDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onCancel())}>
      <DialogContent className="max-w-2xl">
        <AddForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
