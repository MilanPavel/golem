import { editForm, updateFromForm, type EditForm, type EditPair } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpServer } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { fieldClass, Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";

/** Edits one server's `[mcp.<name>]` in the file that names it. The name stays: renaming moves secrets. */
export function EditServer({ server, sessionId, onBack, onCancel, onSaved }: { server: McpServer; sessionId: string | null; onBack?: () => void; onCancel?: () => void; onSaved: () => void }) {
  const actions = usePageActions();
  const detail = useQuery({
    queryKey: ["mcp.get", server.name, sessionId],
    queryFn: () => actions.getMcp(server.name, sessionId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <div className="flex flex-col gap-3">
      {onBack === undefined ? null : (
        <>
          <div>
            <Button size="sm" onClick={onBack}>
              Back
            </Button>
          </div>
          <h3 className="font-mono text-base font-semibold wrap-anywhere">Edit {server.name}</h3>
        </>
      )}
      {detail.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {actionErrorText(detail.error, "Could not read the server.")}
          </p>
          <Button size="sm" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      ) : detail.data === undefined ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : (
        <Fields name={server.name} original={detail.data.config} path={detail.data.path} sessionId={sessionId} onCancel={onCancel ?? onBack} onSaved={onSaved} />
      )}
    </div>
  );
}

type Original = Parameters<typeof editForm>[0];

function Fields({ name, original, path, sessionId, onCancel, onSaved }: { name: string; original: Original; path: string; sessionId: string | null; onCancel?: () => void; onSaved: () => void }) {
  const actions = usePageActions();
  const [form, setForm] = useState<EditForm>(() => editForm(original));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]): void => setForm((now) => ({ ...now, [key]: value }));

  async function save(): Promise<void> {
    const out = updateFromForm(name, original, form);
    if ("error" in out) {
      setError(out.error);
      return;
    }
    setSaving(true);
    try {
      await actions.updateMcp(name, out.config, out.secrets, sessionId);
      onSaved();
    } catch (failure) {
      setError(actionErrorText(failure, `Could not save ${name}.`));
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="font-mono text-xs text-muted wrap-anywhere">{path}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Runs</legend>
        <div className="flex gap-4 text-sm">
          {(["command", "url"] as const).map((target) => (
            <label key={target} className="flex items-center gap-1">
              <input type="radio" name={`${id}-target`} checked={form.target === target} onChange={() => set("target", target)} />
              {target === "command" ? "A command on this Mac" : "A URL"}
            </label>
          ))}
        </div>
        {form.target === "command" ? (
          <label className="flex flex-col gap-1 text-sm">
            Command
            <Input value={form.command} onChange={(event) => set("command", event.target.value)} className="font-mono" spellCheck={false} autoComplete="off" />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            URL
            <Input value={form.url} onChange={(event) => set("url", event.target.value)} className="font-mono" spellCheck={false} autoComplete="off" />
          </label>
        )}
        {form.target === "command" ? (
          <label className="flex flex-col gap-1 text-sm">
            Working folder
            <Input value={form.cwd} onChange={(event) => set("cwd", event.target.value)} className="font-mono" spellCheck={false} autoComplete="off" placeholder="the folder of the chat" />
          </label>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Timeout (seconds)
          <Input value={form.timeout} onChange={(event) => set("timeout", event.target.value)} inputMode="numeric" className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tool calls
          <select value={form.approval} onChange={(event) => set("approval", event.target.value === "allow" ? "allow" : "ask")} className={fieldClass}>
            <option value="ask">ask first</option>
            <option value="allow">run without asking</option>
          </select>
        </label>
      </div>
      <Pairs label="Variables" noun="variable" rows={form.env} onChange={(rows) => set("env", rows)} />
      {form.target === "url" ? <Pairs label="Headers" noun="header" rows={form.headers} onChange={(rows) => set("headers", rows)} /> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Tools</legend>
        <label className="flex flex-col gap-1 text-sm">
          Only these (patterns, one per line; empty is all)
          <Textarea value={form.include} onChange={(event) => set("include", event.target.value)} className="font-mono" spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Never these (patterns, one per line)
          <Textarea value={form.exclude} onChange={(event) => set("exclude", event.target.value)} className="font-mono" spellCheck={false} />
        </label>
      </fieldset>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" kind="primary" disabled={saving}>
          Save
        </Button>
        {onCancel === undefined ? null : <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function Pairs({ label, noun, rows, onChange }: { label: string; noun: string; rows: EditPair[]; onChange: (rows: EditPair[]) => void }) {
  const change = (at: number, next: Partial<EditPair>): void => onChange(rows.map((row, index) => (index === at ? { ...row, ...next } : row)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{label}</legend>
      {rows.map((row, at) => (
        <div key={at} className="flex flex-wrap items-center gap-2">
          <Input aria-label={`${noun} ${at + 1} name`} value={row.key} onChange={(event) => change(at, { key: event.target.value })} className="w-48 font-mono" spellCheck={false} autoComplete="off" />
          <Input
            aria-label={`${noun} ${at + 1} value`}
            type={row.secret ? "password" : "text"}
            value={row.value}
            onChange={(event) => change(at, { value: event.target.value })}
            placeholder={row.secret && row.ref !== null ? "stored in the Keychain; type to replace" : row.secret ? "secret" : ""}
            className="min-w-0 flex-1 font-mono"
            spellCheck={false}
            autoComplete="off"
          />
          {row.ref === null ? (
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={row.secret} onChange={(event) => change(at, { secret: event.target.checked })} />
              secret
            </label>
          ) : null}
          <Button size="sm" aria-label={`Remove ${noun} ${at + 1}`} onClick={() => onChange(rows.filter((_, index) => index !== at))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => onChange([...rows, { key: "", value: "", secret: false, ref: null }])}>
          Add {noun}
        </Button>
      </div>
    </fieldset>
  );
}
