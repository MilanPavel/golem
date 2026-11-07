import {
  appendInstallOutput,
  draftLine,
  entryAvailable,
  entryInputs,
  entryNote,
  entryParams,
  findEntry,
  groupEntries,
  inputDefault,
  inputError,
  mcpNameError,
  missingRuntime,
  OTHER_ID,
  otherSpec,
  type InstallTail,
  type McpCatalogEntry,
  type McpCatalogInput,
} from "@golem/view";
import { useEffect, useId, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import { useMcpCatalog, usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { fieldClass, Input } from "../../../ui/input.tsx";
import { FolderBrowser } from "../../shell/folder-browser.tsx";
import { TestRun } from "./test-view.tsx";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /** The folder a path input starts at. */
  folder: string | null;
  /** The catalog id to open on (`/mcp add <id>`), `other`, or null for the list. */
  initial: string | null;
  onAdded: (name: string) => void;
};

/** Adds a server: pick one golem offers (or a command or URL), fill what it asks, test it, save it. */
export function AddDialog({ open, onOpenChange, sessionId, folder, initial, onAdded }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <Body key={String(initial)} sessionId={sessionId} folder={folder} initial={initial} onClose={() => onOpenChange(false)} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ sessionId, folder, initial, onClose, onAdded }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const catalog = useMcpCatalog(sessionId);
  const [picked, setPicked] = useState<string | null>(initial);
  const entries = catalog.data?.entries ?? [];
  const entry = findEntry(entries, picked);
  const waiting = picked !== null && picked !== OTHER_ID && entry === null;

  if (picked === OTHER_ID) {
    return <OtherForm sessionId={sessionId} onBack={() => setPicked(null)} onAdded={onAdded} onClose={onClose} />;
  }
  if (entry !== null) {
    return <EntryForm key={entry.id} entry={entry} sessionId={sessionId} folder={folder ?? ""} onBack={() => setPicked(null)} onAdded={onAdded} onClose={onClose} />;
  }
  return (
    <>
      <DialogTitle>Add an MCP server</DialogTitle>
      <DialogDescription>Pick one golem offers, or give a command or a URL.</DialogDescription>
      {catalog.isError ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {actionErrorText(catalog.error, "Could not read the list.")}
          </p>
          <Button size="sm" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        </div>
      ) : catalog.data === undefined || waiting ? (
        <p className="mt-3 font-mono text-sm text-muted">{waiting && catalog.data !== undefined ? `${picked} is not in the list.` : "asking the daemon…"}</p>
      ) : (
        <Picker entries={entries} onPick={setPicked} />
      )}
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

function Picker({ entries, onPick }: { entries: readonly McpCatalogEntry[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const groups = groupEntries(entries, query);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Input aria-label="Search the list" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      {groups.map((group) => (
        <section key={group.category} aria-label={group.title} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{group.title}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.entries.map((entry) => {
              const usable = entryAvailable(entry) && entry.added !== true;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={!usable}
                    onClick={() => onPick(entry.id)}
                    className="flex h-full w-full flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-left outline-offset-2 outline-clay hover:border-line-strong focus-visible:outline-2 disabled:opacity-60"
                  >
                    <span className="text-sm font-semibold">{entry.title}</span>
                    <span className="text-xs text-muted">{entryNote(entry)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {groups.length === 0 ? <p className="text-sm text-muted">Nothing in the list matches “{query}”.</p> : null}
      <button
        type="button"
        onClick={() => onPick(OTHER_ID)}
        className="flex flex-col gap-1 rounded-lg border border-dashed border-line-strong px-3 py-2 text-left outline-offset-2 outline-clay hover:border-clay focus-visible:outline-2"
      >
        <span className="text-sm font-semibold">Another server</span>
        <span className="text-xs text-muted">A command that runs on this Mac, or an https:// URL.</span>
      </button>
    </div>
  );
}

function Actions({ onBack, onClose, children }: { onBack: () => void; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <Button onClick={onBack}>Back</Button>
      <Button onClick={onClose}>Cancel</Button>
      {children}
    </div>
  );
}

function NameField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Name
      <Input value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error !== null} className="font-mono" spellCheck={false} autoComplete="off" />
      {error === null ? null : <span className="text-xs text-deny">{error}</span>}
    </label>
  );
}

function EntryForm({ entry, sessionId, folder, onBack, onAdded, onClose }: { entry: McpCatalogEntry; sessionId: string | null; folder: string; onBack: () => void; onAdded: (name: string) => void; onClose: () => void }) {
  const actions = usePageActions();
  const inputs = entryInputs(entry);
  const [name, setName] = useState(entry.name);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map((input) => [input.id, inputDefault(input, folder)])));
  const [shown, setShown] = useState(false);
  const [testing, setTesting] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const runtime = missingRuntime(entry);

  function problem(): string | null {
    return mcpNameError(name) ?? inputs.map((input) => inputError(input, values[input.id] ?? "")).find((text) => text !== null) ?? null;
  }

  function draft() {
    const params = entryParams(entry, values);
    return { catalogId: entry.id, inputs: params.inputs ?? {}, secrets: params.secrets ?? {}, name };
  }

  async function save(): Promise<void> {
    const text = problem();
    if (text !== null) {
      setFailure(text);
      return;
    }
    setSaving(true);
    try {
      await actions.addMcp({ ...entryParams(entry, values), name });
      onAdded(name);
    } catch (error) {
      setFailure(actionErrorText(error, `Could not add ${name}.`));
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogTitle>Add {entry.title}</DialogTitle>
      <DialogDescription>{entry.description}</DialogDescription>
      {runtime === null ? null : <Install name={runtime} />}
      <NameField value={name} onChange={setName} error={name.length === 0 ? null : mcpNameError(name)} />
      {inputs.map((input) => (
        <InputField
          key={input.id}
          input={input}
          value={values[input.id] ?? ""}
          onChange={(value) => setValues((now) => ({ ...now, [input.id]: value }))}
          startAt={folder}
        />
      ))}
      <p className="text-xs text-muted">
        It runs with {entry.runtime === "url" ? "a URL" : entry.runtime}. golem will run it on your Mac.{" "}
        <a href={entry.homepage} target="_blank" rel="noreferrer" className="text-clay-ink underline underline-offset-2">
          Homepage
        </a>
      </p>
      {entry.auth === "oauth" ? <p className="text-xs text-muted">It signs in in your browser after it is added.</p> : null}
      {shown ? <TestRun key={testing} start={(onStep) => actions.testMcpDraft(draft(), sessionId, onStep)} /> : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      <Actions onBack={onBack} onClose={onClose}>
        <Button
          onClick={() => {
            const text = problem();
            setFailure(text);
            if (text !== null) return;
            setShown(true);
            setTesting((now) => now + 1);
          }}
        >
          Test
        </Button>
        <Button type="submit" kind="primary" disabled={saving || runtime !== null}>
          Add
        </Button>
      </Actions>
    </form>
  );
}

function InputField({ input, value, onChange, startAt }: { input: McpCatalogInput; value: string; onChange: (value: string) => void; startAt: string }) {
  const id = useId();
  const [browsing, setBrowsing] = useState(false);
  const error = value.length === 0 ? null : inputError(input, value);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{input.label}</label>
      {input.kind === "choice" ? (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
          {(input.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex gap-2">
          <Input
            id={id}
            type={input.kind === "secret" ? "password" : "text"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error !== null}
            className={input.kind === "secret" ? "" : "font-mono"}
            spellCheck={false}
            autoComplete="off"
          />
          {input.kind === "path" ? (
            <Button size="sm" onClick={() => setBrowsing((now) => !now)}>
              Browse…
            </Button>
          ) : null}
        </div>
      )}
      {input.hint == null ? null : <span className="text-xs text-muted">{input.hint}</span>}
      {error === null ? null : <span className="text-xs text-deny">{error}</span>}
      {browsing ? (
        <div className="rounded-lg border border-line">
          <FolderBrowser
            initialPath={value.startsWith("/") ? value : startAt === "" ? null : startAt}
            autoFocus
            onPick={(path) => {
              onChange(path);
              setBrowsing(false);
            }}
            onCancel={() => setBrowsing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function OtherForm({ sessionId, onBack, onAdded, onClose }: { sessionId: string | null; onBack: () => void; onAdded: (name: string) => void; onClose: () => void }) {
  const actions = usePageActions();
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [testing, setTesting] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const spec = otherSpec(name, line);

  function problem(): string | null {
    return mcpNameError(name) ?? ("error" in spec ? spec.error : null);
  }

  async function save(): Promise<void> {
    const text = problem();
    if (text !== null || "error" in spec) {
      setFailure(text);
      return;
    }
    setSaving(true);
    try {
      await actions.addMcp(spec.spec);
      onAdded(name);
    } catch (error) {
      setFailure(actionErrorText(error, `Could not add ${name}.`));
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogTitle>Add another server</DialogTitle>
      <DialogDescription>A command that runs on this Mac, or an https:// URL.</DialogDescription>
      <NameField value={name} onChange={setName} error={name.length === 0 ? null : mcpNameError(name)} />
      <label className="flex flex-col gap-1 text-sm">
        Command or URL
        <Input value={line} onChange={(event) => setLine(event.target.value)} className="font-mono" spellCheck={false} autoComplete="off" placeholder="npx -y @scope/server" />
      </label>
      {"spec" in spec && line.trim().length > 0 ? (
        <p className="text-xs text-muted">
          <span className="font-mono wrap-anywhere">{draftLine(spec.spec)}</span>
          <br />
          {spec.spec.url == null ? "golem will run this on your Mac." : "golem will connect to this address."}
        </p>
      ) : null}
      {testing > 0 && "spec" in spec ? (
        <TestRun
          key={testing}
          start={(onStep) =>
            actions.testMcpDraft(
              { config: spec.spec.url == null ? { command: spec.spec.command ?? "", args: spec.spec.args ?? [] } : { url: spec.spec.url }, secrets: {} },
              sessionId,
              onStep,
            )
          }
        />
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      <Actions onBack={onBack} onClose={onClose}>
        <Button
          onClick={() => {
            const text = problem();
            setFailure(text);
            if (text === null) setTesting((now) => now + 1);
          }}
        >
          Test
        </Button>
        <Button type="submit" kind="primary" disabled={saving}>
          Add
        </Button>
      </Actions>
    </form>
  );
}

/** Node or uv is missing: offer to install it with Homebrew, and show the output as it comes. */
function Install({ name }: { name: "node" | "uv" }) {
  const actions = usePageActions();
  const [running, setRunning] = useState(false);
  const [tail, setTail] = useState<InstallTail>({ last: "", partial: "" });
  const [failure, setFailure] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const label = name === "node" ? "Node" : "uv";

  async function start(): Promise<void> {
    setRunning(true);
    setFailure(null);
    setStopped(false);
    setTail({ last: "", partial: "" });
    try {
      const started = await actions.installRuntime(name, (event) => {
        if (!live.current) return;
        if (event.kind === "output") setTail((now) => appendInstallOutput(now, event.text));
        else {
          setRunning(false);
          if (event.kind === "error") setFailure(event.message);
          else if (event.stopped) setStopped(true);
        }
      });
      if (!started) setRunning(false);
    } catch (error) {
      setRunning(false);
      setFailure(actionErrorText(error, `Could not install ${label}.`));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <p>This server needs {label}, which is not installed.</p>
      <div className="flex gap-2">
        {running ? (
          <Button size="sm" onClick={() => void actions.cancelRuntimeInstall(name)}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()}>
            Install {label}
          </Button>
        )}
      </div>
      {running ? (
        <p role="status" aria-live="polite" className="font-mono text-xs text-muted wrap-anywhere">
          {tail.partial.trim().length > 0 ? tail.partial.split("\r").at(-1) : tail.last || `installing ${label}…`}
        </p>
      ) : null}
      {stopped ? <p className="text-xs text-muted">Stopped.</p> : null}
      {failure === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {failure}
        </p>
      )}
    </div>
  );
}
