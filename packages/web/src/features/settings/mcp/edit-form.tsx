import { editForm, isRefused, tokenTestFailure, tokenTestRows, updateFromForm, type EditForm, type EditPair } from "@golem/view";
import { useId, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpServer, McpTestProgress } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Badge } from "../../../ui/badge.tsx";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { cn } from "../../../ui/cn.ts";
import { LockIcon } from "../../../ui/icons.tsx";
import { fieldClass, Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";
import { useMcpDetail } from "./use-detail.ts";

/** What the Edit tab tells the section about the token it just tested, so the sign-in line keeps up. */
export type TokenOutcome = { ok: true } | { ok: false; refused: boolean };

/**
 * Edits one server's `[mcp.<name>]` in the file that names it. The name stays: renaming moves secrets.
 * `tokenRequest` goes up each time the sign-in line asks for the token: its field opens with the cursor in it.
 */
export function EditServer({
  server,
  sessionId,
  tokenRequest = 0,
  onToken,
  onBack,
  onCancel,
  onSaved,
}: {
  server: McpServer;
  sessionId: string | null;
  tokenRequest?: number;
  onToken?: (outcome: TokenOutcome) => void;
  onBack?: () => void;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const detail = useMcpDetail(server.name, sessionId);
  return (
    <div className="flex flex-col gap-3">
      {onBack === undefined ? null : (
        <>
          <div>
            <Button size="sm" onClick={onBack}>
              Back
            </Button>
          </div>
          <h3 className="text-heading font-semibold wrap-anywhere">Edit <Code>{server.name}</Code></h3>
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
        <p className="text-body text-muted">loading…</p>
      ) : (
        <Fields
          name={server.name}
          original={detail.data.config}
          path={detail.data.path}
          stored={new Map((detail.data.secrets ?? []).map((secret) => [secret.ref, secret.stored]))}
          sessionId={sessionId}
          tokenRequest={tokenRequest}
          onToken={onToken}
          onCancel={onCancel ?? onBack}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

type Original = Parameters<typeof editForm>[0];
type List = "env" | "headers";
type Shown = readonly Pick<McpTestProgress, "step" | "state" | "detail">[];

/** Where a token's field is open: the list and the row, as `headers:0`. */
type Opened = ReadonlySet<string>;

/** The token test, as it goes and as it ended. The saved server is not touched until it passes or the person keeps the token. */
export type TokenTest =
  | { phase: "running"; steps: Shown }
  | { phase: "passed"; steps: Shown; message: string }
  | { phase: "failed"; steps: Shown; message: string; out: SavedForm };

export type SavedForm = Exclude<ReturnType<typeof updateFromForm>, { error: string }>;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function Fields({
  name,
  original,
  path,
  stored,
  sessionId,
  tokenRequest,
  onToken,
  onCancel,
  onSaved,
}: {
  name: string;
  original: Original;
  path: string;
  stored: ReadonlyMap<string, boolean>;
  sessionId: string | null;
  tokenRequest: number;
  onToken?: (outcome: TokenOutcome) => void;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const actions = usePageActions();
  const [form, setForm] = useState<EditForm>(() => editForm(original));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opened, setOpened] = useState<Opened>(new Set());
  const [test, setTest] = useState<TokenTest | null>(null);
  /** Bumped by Try again, so the field starts again with the cursor in it. */
  const [round, setRound] = useState(0);
  const steps = useRef<McpTestProgress[]>([]);
  const id = useId();
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]): void => setForm((now) => ({ ...now, [key]: value }));
  const typed = [...form.env, ...form.headers].some((row) => row.secret && row.value.length > 0);

  // The sign-in line asked for the token: open the field of the one that is missing, else the first.
  const [seenRequest, setSeenRequest] = useState(0);
  if (tokenRequest !== seenRequest) {
    setSeenRequest(tokenRequest);
    const rows = (["headers", "env"] as const).flatMap((list) => form[list].flatMap((row, at) => (row.ref === null ? [] : [{ list, at, ref: row.ref }])));
    const target = rows.find((row) => stored.get(row.ref) === false) ?? rows[0];
    if (target !== undefined) setOpened((now) => new Set(now).add(`${target.list}:${target.at}`));
  }

  async function keep(out: SavedForm, steps: Shown, message: string): Promise<void> {
    setSaving(true);
    try {
      await actions.updateMcp(name, out.config, out.secrets, sessionId);
      // The token is stored now: the form shows it as a reference again, with nothing typed.
      setForm(editForm(out.config));
      setOpened(new Set());
      setTest({ phase: "passed", steps, message });
      setError(null);
    } catch (failure) {
      setError(actionErrorText(failure, `Could not save ${name}.`));
    }
    setSaving(false);
  }

  async function saveAndTest(out: SavedForm): Promise<void> {
    steps.current = [];
    setTest({ phase: "running", steps: [] });
    setError(null);
    const hadOne = [...form.env, ...form.headers].every((row) => !(row.secret && row.value.length > 0) || (row.ref !== null && stored.get(row.ref) !== false));
    try {
      const result = await actions.testMcpDraft({ config: out.config, secrets: out.secrets }, sessionId, (step) => {
        steps.current = [...steps.current, step];
        setTest({ phase: "running", steps: steps.current });
      });
      if (result.ok) {
        onToken?.({ ok: true });
        await keep(out, result.steps, hadOne ? "The new token works. It replaced the old one." : "The new token works and is saved.");
        return;
      }
      onToken?.({ ok: false, refused: isRefused(result.http_status, null) });
      setTest({ phase: "failed", steps: result.steps, message: tokenTestFailure(result, hadOne), out });
    } catch (failure) {
      const tail = hadOne ? "Your old token is still in use." : "Nothing was saved.";
      setTest({ phase: "failed", steps: steps.current, message: `${actionErrorText(failure, "The test could not run.")} ${tail}`, out });
    }
  }

  async function save(): Promise<void> {
    const out = updateFromForm(name, original, form);
    if ("error" in out) {
      setError(out.error);
      return;
    }
    if (Object.keys(out.secrets).length > 0) {
      await saveAndTest(out);
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

  /** Try again: the typed token goes, and the field is empty and has the cursor. */
  function tryAgain(): void {
    const clear = (rows: EditPair[]): EditPair[] => rows.map((row) => (row.secret ? { ...row, value: "" } : row));
    setForm((now) => ({ ...now, env: clear(now.env), headers: clear(now.headers) }));
    setTest(null);
    setRound((now) => now + 1);
  }

  const host = hostOf(form.url);
  const running = test?.phase === "running";
  const tokens = {
    stored,
    opened,
    round,
    onOpen: (list: List, at: number): void => setOpened((now) => new Set(now).add(`${list}:${at}`)),
    onClose: (list: List, at: number): void => setOpened((now) => new Set([...now].filter((item) => item !== `${list}:${at}`))),
    // Taking a row out moves the ones after it up, and their fields stay open with them.
    onRemoved: (list: List, at: number): void =>
      setOpened((now) => {
        const next = new Set<string>();
        for (const item of now) {
          const [from, row] = item.split(":");
          const index = Number(row);
          if (from !== list || index < at) next.add(item);
          else if (index > at) next.add(`${from}:${index - 1}`);
        }
        return next;
      }),
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-meta text-muted wrap-anywhere"><Code tone="muted">{path}</Code></p>
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
          Approval
          <select value={form.approval} onChange={(event) => set("approval", event.target.value === "allow" ? "allow" : event.target.value === "read-only" ? "read-only" : "ask")} className={fieldClass}>
            <option value="ask">Ask before every tool</option>
            <option value="read-only">Trust its read-only tools</option>
            <option value="allow">Allow every tool</option>
          </select>
        </label>
      </div>
      <Pairs label="Variables" noun="variable" list="env" rows={form.env} onChange={(rows) => set("env", rows)} {...tokens} />
      {form.target === "url" ? <Pairs label="Headers" noun="header" list="headers" rows={form.headers} onChange={(rows) => set("headers", rows)} {...tokens} /> : null}
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
      {test === null ? null : <TokenTestView test={test} host={host} onTryAgain={tryAgain} onKeep={(out, shown) => void keep(out, shown, "Kept the new token. The server may still refuse it.")} />}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" kind="primary" disabled={saving || running}>
          {typed ? "Save and test" : "Save"}
        </Button>
        {onCancel === undefined ? null : <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

type PairsProps = {
  label: string;
  noun: string;
  list: List;
  rows: EditPair[];
  onChange: (rows: EditPair[]) => void;
  stored: ReadonlyMap<string, boolean>;
  opened: Opened;
  round: number;
  onOpen: (list: List, at: number) => void;
  onClose: (list: List, at: number) => void;
  onRemoved: (list: List, at: number) => void;
};

function Pairs({ label, noun, list, rows, onChange, stored, opened, round, onOpen, onClose, onRemoved }: PairsProps) {
  const change = (at: number, next: Partial<EditPair>): void => onChange(rows.map((row, index) => (index === at ? { ...row, ...next } : row)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{label}</legend>
      {rows.map((row, at) => (
        <div key={at} className="flex flex-wrap items-center gap-2">
          <Input aria-label={`${noun} ${at + 1} name`} value={row.key} onChange={(event) => change(at, { key: event.target.value })} className="w-48 font-mono" spellCheck={false} autoComplete="off" />
          {row.ref === null ? (
            <>
              <Input
                aria-label={`${noun} ${at + 1} value`}
                type={row.secret ? "password" : "text"}
                value={row.value}
                onChange={(event) => change(at, { value: event.target.value })}
                placeholder={row.secret ? "secret" : ""}
                className="min-w-0 flex-1 font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={row.secret} onChange={(event) => change(at, { secret: event.target.checked })} />
                secret
              </label>
            </>
          ) : (
            <StoredValue
              noun={`${noun} ${at + 1}`}
              row={row}
              there={stored.get(row.ref) !== false}
              open={opened.has(`${list}:${at}`) || row.value.length > 0}
              round={round}
              onType={(value) => change(at, { value })}
              onOpen={() => onOpen(list, at)}
              onClose={() => {
                change(at, { value: "" });
                onClose(list, at);
              }}
            />
          )}
          <Button
            size="sm"
            aria-label={`Remove ${noun} ${at + 1}`}
            onClick={() => {
              onChange(rows.filter((_, index) => index !== at));
              onRemoved(list, at);
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => onChange([...rows, { key: "", value: "", secret: false, ref: null, prefix: "" }])}>
          Add {noun}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * A value that is a Keychain reference: its prefix (`Bearer`), then a pill that says it is kept there.
 * Replace turns the pill into a password field. What is stored is never read back into the page.
 */
export function StoredValue({
  noun,
  row,
  there,
  open,
  round,
  onType,
  onOpen,
  onClose,
}: {
  noun: string;
  row: EditPair;
  there: boolean;
  open: boolean;
  round: number;
  onType: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const prefix = row.prefix.trim();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-line-strong bg-surface px-2 py-1">
      {prefix.length === 0 ? null : <Code>{prefix}</Code>}
      {open ? (
        <>
          <Input
            key={round}
            autoFocus
            aria-label={`${noun} value`}
            type="password"
            value={row.value}
            onChange={(event) => onType(event.target.value)}
            placeholder="Paste the new token"
            className="min-w-0 flex-1 font-mono"
            spellCheck={false}
            autoComplete="off"
          />
          <Button size="sm" aria-label={`Cancel the new value of ${noun}`} onClick={onClose}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Badge tone={there ? "allow" : "deny"}>
            <LockIcon className="size-3" />
            {there ? "in the Keychain" : "not in the Keychain"}
          </Badge>
          <Button size="sm" className="ml-auto" aria-label={`${there ? "Replace" : "Add"} the token of ${noun}`} onClick={onOpen}>
            {there ? "Replace" : "Add token"}
          </Button>
        </>
      )}
    </div>
  );
}

/** The steps of the test as they pass, and when it did not pass, the two choices. */
export function TokenTestView({
  test,
  host,
  onTryAgain,
  onKeep,
}: {
  test: TokenTest;
  host: string | null;
  onTryAgain: () => void;
  onKeep: (out: SavedForm, steps: Shown) => void;
}) {
  const rows = tokenTestRows(test.steps, host);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm">
      <ol aria-label="Test steps" aria-live="polite" className="flex flex-col gap-0.5">
        {rows.map((row, index) => (
          <li key={index} className={cn("wrap-anywhere", row.ok ? "text-allow" : "text-deny")}>
            {row.ok ? "✓" : "✗"} {row.text}
          </li>
        ))}
      </ol>
      {test.phase === "running" ? <p className="text-muted">testing…</p> : null}
      {test.phase === "passed" ? (
        <p role="status" className="font-semibold">
          {test.message}
        </p>
      ) : null}
      {test.phase === "failed" ? (
        <>
          <p role="alert" className="text-deny">
            {test.message}
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={onTryAgain}>
              Try again
            </Button>
            <Button size="sm" kind="ghost" onClick={() => onKeep(test.out, test.steps)}>
              Keep it anyway
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
