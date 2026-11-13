import { OLLAMA_DOWNLOAD_URL, providerName, type FormButtonId, type FormFix, type FormMark, type FormRow, type Mark } from "@golem/view";
import { useId, useState, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { MarkGlyph } from "./mark-glyph.tsx";
import { installLog, type SetupActionsState } from "./use-setup-actions.ts";

const MARKS: Record<FormMark, Mark> = { ok: "ok", warn: "attn", fail: "fail" };

/** The card's own key: a part has several cards when it has several rows. */
export function cardKey(row: FormRow): string {
  return `${row.part}:${row.name}`;
}

export type SetupFormViewProps = {
  rows: readonly FormRow[];
  actions: SetupActionsState;
  /** A button of a card was pressed. `from` is the element, for focus to come back to. */
  onButton: (id: FormButtonId, card: string, from: HTMLElement) => void;
  onCancelInstall: () => void;
  onNavigate: (path: string) => void;
  /** Whether the page has the section a link points to. A link to one that is not there yet is left out. */
  hasPage: (path: string) => boolean;
};

function Working({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <MarkGlyph mark="spin" />
      <span role="status">{children}</span>
    </span>
  );
}

const OLLAMA = providerName("ollama");

type FixProps = SetupFormViewProps & { row: FormRow; fix: FormFix };

function Fix({ row, fix, actions, onButton, onCancelInstall, onNavigate, hasPage }: FixProps) {
  const card = cardKey(row);
  const checking = actions.running === "check" && actions.from === card;
  const checkButton = (
    <Button
      size="sm"
      disabled={actions.running !== null}
      aria-busy={checking}
      onClick={(event) => {
        onButton("check_again", card, event.currentTarget);
      }}
    >
      Check again
    </Button>
  );
  if (fix.kind === "command") {
    if (fix.recheck === false) return <CopyCommand command={fix.text} />;
    return (
      <>
        <CopyCommand command={fix.text} />
        {checking ? <Working>Checking…</Working> : checkButton}
      </>
    );
  }
  if (fix.kind === "link") {
    if (!hasPage(fix.to)) return null;
    return (
      <Link
        href={fix.to}
        onNavigate={onNavigate}
        className="rounded-md px-2 py-1 text-sm text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {fix.label}
      </Link>
    );
  }
  const ollama = row.part === "engine" && row.name === OLLAMA;
  if (ollama && (fix.id === "install_ollama" || fix.id === "start_ollama")) {
    if (actions.noBrew) {
      return (
        <>
          <a
            href={OLLAMA_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-2 py-1 text-sm text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
          >
            Download Ollama
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {checkButton}
        </>
      );
    }
    if (actions.running === "install") {
      return (
        <>
          <Working>Installing Ollama…</Working>
          <Button size="sm" onClick={onCancelInstall}>
            Cancel install
          </Button>
        </>
      );
    }
    if (actions.running === "start") return <Working>Starting Ollama…</Working>;
  }
  if (fix.id === "check_again") return checking ? <Working>Checking…</Working> : checkButton;
  return (
    <Button
      size="sm"
      kind={fix.id === "change_model" ? "secondary" : "ink"}
      disabled={actions.running !== null}
      onClick={(event) => {
        onButton(fix.id, card, event.currentTarget);
      }}
    >
      {fix.label}
    </Button>
  );
}

/** What the install printed, under the row: open while it runs, folded once it ends. */
export function Output({ output, running }: { output: string; running: boolean }) {
  const text = installLog(output);
  if (text === "") return null;
  return (
    <details open={running} className="mt-2 text-sm">
      <summary className="cursor-pointer text-muted outline-offset-2 outline-clay focus-visible:outline-2">Output</summary>
      <pre
        tabIndex={0}
        className="mt-1 max-h-48 overflow-auto rounded-md bg-code-bg p-2 font-mono text-xs whitespace-pre-wrap text-ink outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {text}
      </pre>
    </details>
  );
}

export type SetupHeaderProps = { mark: Mark; text: string; onRunAgain: () => void };

/** `All set`, or the first problem, with its mark, and the way to walk through setup again. */
export function SetupHeader({ mark, text, onRunAgain }: SetupHeaderProps) {
  return (
    <div className="flex items-center gap-2.5">
      <MarkGlyph mark={mark} />
      <p role="status" className="font-semibold">
        {text}
      </p>
      <Button kind="ghost" size="sm" className="ml-auto" onClick={onRunAgain}>
        Run setup again
      </Button>
    </div>
  );
}

const TINT: Record<FormMark, string> = { ok: "", warn: "bg-wait-soft", fail: "bg-deny-soft" };
const DETAIL_TONE: Record<FormMark, string> = { ok: "text-muted", warn: "text-wait", fail: "text-deny" };

function Card(props: SetupFormViewProps & { row: FormRow }) {
  const { row, actions } = props;
  const card = cardKey(row);
  const ollama = row.part === "engine" && row.name === OLLAMA;
  const error =
    actions.error === null
      ? null
      : actions.error.action === "check"
        ? actions.from === card
          ? actions.error.text
          : null
        : ollama
          ? actions.error.text
          : null;
  const extra = (actions.noBrew && ollama) || error !== null || ollama;
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 ${TINT[row.mark]}`}>
      <MarkGlyph mark={MARKS[row.mark]} />
      <p className="w-24 shrink-0 font-semibold">{row.name}</p>
      <p title={row.detail} className={`min-w-0 flex-1 truncate text-sm ${DETAIL_TONE[row.mark]}`}>
        {row.detail}
      </p>
      {row.fix === null ? null : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Fix {...props} fix={row.fix} />
        </div>
      )}
      {extra ? (
        <div className="w-full pl-7">
          {actions.noBrew && ollama ? <p className="text-sm text-muted">Homebrew isn't installed. Download Ollama, then check again.</p> : null}
          {error === null ? null : (
            <p role="alert" className="text-sm text-deny">
              {error}
            </p>
          )}
          {ollama ? <Output output={actions.output} running={actions.running === "install"} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Settings → Setup: one bordered panel with a row for each part of setup, the fix on the right. */
export function SetupFormView(props: SetupFormViewProps) {
  return (
    <ul aria-label="Setup" className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {props.rows.map((row) => (
        <Card key={cardKey(row)} {...props} row={row} />
      ))}
    </ul>
  );
}

/** A provider that takes an API key, and whether golem has one saved for it. */
export type KeyProvider = { id: string; name: string; blurb: string; saved: boolean };

export type AddKeyProps = {
  /** Every provider that takes a key, in the order to show them. */
  providers: readonly KeyProvider[];
  actions: SetupActionsState;
  onCheck: (from: HTMLElement) => void;
  /** The provider whose line starts open. The gallery uses it. */
  initialOpen?: string | null;
};

const CHIP = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium outline-offset-2 outline-clay focus-visible:outline-2";

/**
 * Under the status rows: a chip for each provider, saved ones in the allow tone. A chip opens one
 * line with the command that stores a key. The page only knows whether a key is saved, never its
 * value, and never takes one.
 */
export function AddKey({ providers, actions, onCheck, initialOpen = null }: AddKeyProps) {
  const id = useId();
  const [open, setOpen] = useState<string | null>(initialOpen);
  const chosen = providers.find((item) => item.id === open) ?? null;
  const checking = actions.running === "check" && actions.from === "key";
  if (providers.length === 0) return null;
  return (
    <div role="group" aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        <span id={`${id}-title`}>API keys</span> <span className="font-normal text-muted">· optional, for cloud models</span>
      </h3>
      <div className="flex flex-wrap gap-2">
        {providers.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-expanded={open === item.id}
            onClick={() => {
              setOpen(open === item.id ? null : item.id);
            }}
            className={cn(
              CHIP,
              item.saved ? "border-transparent bg-allow-soft text-allow" : "border-line-strong bg-surface text-muted hover:border-ink hover:text-ink",
              open === item.id && "border-clay text-ink ring-1 ring-clay",
            )}
          >
            <span aria-hidden="true">{item.saved ? "✓" : "+"}</span>
            {item.name}
            <small className="font-mono text-xs">{item.saved ? "saved" : item.blurb}</small>
          </button>
        ))}
      </div>
      {chosen === null ? null : (
        <div
          role="group"
          aria-label={`${chosen.name} key`}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-line-strong px-3 py-2"
        >
          {chosen.saved ? <span className="text-sm">Key saved. To replace it:</span> : null}
          <CopyCommand command={`golem auth set ${chosen.id}`} />
          {checking ? (
            <Working>Checking…</Working>
          ) : (
            <Button
              size="sm"
              kind="ghost"
              disabled={actions.running !== null}
              onClick={(event) => {
                onCheck(event.currentTarget);
              }}
            >
              Check again
            </Button>
          )}
          <p className="w-full text-sm text-muted">The page never takes a key. Paste it in a terminal.</p>
          {actions.error?.action === "check" && actions.from === "key" ? (
            <p role="alert" className="w-full text-sm text-deny">
              {actions.error.text}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
