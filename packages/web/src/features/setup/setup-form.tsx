import { OLLAMA_DOWNLOAD_URL, providerName, type FormButtonId, type FormFix, type FormMark, type FormRow, type Mark } from "@golem/view";
import { useId, useState, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { fieldClass } from "../../ui/input.tsx";
import { Link } from "../../ui/link.tsx";
import { MarkGlyph } from "./panel-body.tsx";
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
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5">
          <MarkGlyph mark={MARKS[row.mark]} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{row.name}</p>
          <p className="text-sm break-words text-muted">{row.detail}</p>
          {actions.noBrew && ollama ? (
            <p className="mt-1 text-sm text-muted">Homebrew isn't installed. Download Ollama, then check again.</p>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="mt-1 text-sm text-deny">
              {error}
            </p>
          )}
          {ollama ? <Output output={actions.output} running={actions.running === "install"} /> : null}
        </div>
      </div>
      {row.fix === null ? null : (
        <div className="flex flex-wrap items-center gap-2 pl-7">
          <Fix {...props} fix={row.fix} />
        </div>
      )}
    </li>
  );
}

/** The cards of Settings → Setup. Every part of setup is a card with the fix beside it. */
export function SetupFormView(props: SetupFormViewProps) {
  return (
    <ul aria-label="Setup" className="grid grid-cols-1 gap-3 md:grid-cols-2 wide:grid-cols-3">
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
};

/**
 * Under the cards: which providers have a key saved, then the command that stores one. The page
 * only knows whether a key is saved, never its value, and never takes one.
 */
export function AddKey({ providers, actions, onCheck }: AddKeyProps) {
  const id = useId();
  const [picked, setPicked] = useState<string | null>(null);
  // Offer the first provider with no key, else the first.
  const chosen =
    providers.find((item) => item.id === picked) ?? providers.find((item) => !item.saved) ?? providers[0] ?? null;
  const checking = actions.running === "check" && actions.from === "key";
  if (providers.length === 0) return null;
  return (
    <div role="group" aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h3 id={`${id}-title`} className="font-medium">
        API keys
      </h3>
      <ul aria-label="Saved keys" className="flex flex-col divide-y divide-line text-sm">
        {providers.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-1.5">
            <span className="w-24 font-medium">{item.name}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{item.blurb}</span>
            {item.saved ? (
              <span className="inline-flex items-center gap-1.5 text-ink">
                <MarkGlyph mark="ok" />
                key saved
              </span>
            ) : (
              <span className="text-muted">no key</span>
            )}
          </li>
        ))}
      </ul>
      {chosen === null ? null : (
        <>
          <p className="text-sm text-muted">
            The page never takes a key. In a terminal, run this and paste the key there{chosen.saved ? ", to replace the saved one" : ""}:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-provider`} className="sr-only">
              Provider
            </label>
            <select
              id={`${id}-provider`}
              value={chosen.id}
              onChange={(event) => {
                setPicked(event.target.value);
              }}
              className={`${fieldClass} w-auto`}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.saved ? `${item.name} · key saved` : item.name}
                </option>
              ))}
            </select>
            <CopyCommand command={`golem auth set ${chosen.id}`} />
            {checking ? (
              <Working>Checking…</Working>
            ) : (
              <Button
                size="sm"
                disabled={actions.running !== null}
                onClick={(event) => {
                  onCheck(event.currentTarget);
                }}
              >
                Check again
              </Button>
            )}
          </div>
          {actions.error?.action === "check" && actions.from === "key" ? (
            <p role="alert" className="text-sm text-deny">
              {actions.error.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
