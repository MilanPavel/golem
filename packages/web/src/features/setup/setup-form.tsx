import { OLLAMA_DOWNLOAD_URL, providerName, type FormButtonId, type FormFix, type FormMark, type FormRow, type Mark } from "@golem/view";
import { useId, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { settingsPath } from "../../store/router.ts";
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
    <span className="inline-flex items-center gap-2 text-body text-muted">
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
    return <CopyCommand command={fix.text} />;
  }
  if (fix.kind === "link") {
    if (!hasPage(fix.to)) return null;
    return (
      <Link
        href={fix.to}
        onNavigate={onNavigate}
        className="rounded-md px-2 py-1 text-body font-medium text-clay-ink outline-offset-2 hover:underline outline-clay focus-visible:outline-2"
      >
        {row.part === "tools" ? "MCP servers →" : fix.label}
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
            className="rounded-md px-2 py-1 text-body font-medium text-clay-ink outline-offset-2 hover:underline outline-clay focus-visible:outline-2"
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
  // A model that works is changed in Routing: its row has the link, no button.
  if (fix.id === "change_model" && row.mark === "ok") return null;
  if (fix.id === "check_again") return checking ? <Working>Checking…</Working> : checkButton;
  return (
    <Button
      size="sm"
      kind="primary"
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
    <details open={running} className="mt-2 text-body">
      <summary className="cursor-pointer text-muted outline-offset-2 outline-clay focus-visible:outline-2">Output</summary>
      <pre
        tabIndex={0}
        className="mt-1 max-h-48 overflow-auto rounded-md bg-code-bg p-2 whitespace-pre-wrap outline-offset-2 outline-clay focus-visible:outline-2"
      >
        <Code>{text}</Code>
      </pre>
    </details>
  );
}

const TINT: Record<FormMark, string> = { ok: "", warn: "bg-wait-soft", fail: "bg-deny-soft" };
const DETAIL_TONE: Record<FormMark, string> = { ok: "text-muted", warn: "text-wait", fail: "text-deny" };

// A model id (`ollama/qwen3:8b`) or a host and port, the literals a row's text can hold.
const LITERAL = /(\b[a-z][\w-]*\/[\w.:-]+|\b(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):\d+)/;

/** The text with its model ids and hosts in `<Code>`. A model id drops `ollama/`: the row already says which provider. */
function Literals({ text }: { text: string }) {
  return (
    <>
      {text.split(LITERAL).map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          <Code key={index} tone="muted">
            {part.replace(/^ollama\//, "")}
          </Code>
        ),
      )}
    </>
  );
}
const CIRCLE: Record<FormMark, string> = { ok: "bg-allow-soft", warn: "bg-wait-soft", fail: "bg-deny-soft" };

/** A plain sentence for a row that needs fixing; null when the daemon's own words are the best there are. */
function sentence(row: FormRow): string | null {
  if (row.mark === "ok") return null;
  if (row.name === "Service") return "Running, but stops when you log out.";
  if (row.name === "Web page") return "Only works while a terminal runs golem.";
  if (row.name === OLLAMA) return row.mark === "fail" ? "Ollama isn't installed." : "Ollama isn't running, so models can't load.";
  if (row.part === "model") return "No model is chosen yet.";
  if (row.part === "engine" && row.fix?.kind === "command") return "Needs an API key.";
  return null;
}

function Card(props: SetupFormViewProps & { row: FormRow }) {
  const { row, actions, hasPage, onNavigate } = props;
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
  const plain = sentence(row);
  const routing = settingsPath("routing");
  return (
    <li data-setting={row.name.toLowerCase()} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${TINT[row.mark]}`}>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${CIRCLE[row.mark]}`}>
        <MarkGlyph mark={MARKS[row.mark]} />
      </span>
      <p className="w-24 shrink-0 text-label font-medium">{row.name}</p>
      <p title={row.detail} className={`min-w-0 flex-1 basis-48 text-body ${plain === null ? DETAIL_TONE[row.mark] : "text-ink-soft"}`}>
        {plain ?? <Literals text={row.detail} />}
      </p>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {row.fix === null ? null : <Fix {...props} fix={row.fix} />}
        {row.part === "model" && row.mark === "ok" && hasPage(routing) ? (
          <Link
            href={routing}
            onNavigate={onNavigate}
            className="rounded-md px-2 py-1 text-body font-medium text-clay-ink outline-offset-2 hover:underline outline-clay focus-visible:outline-2"
          >
            Routing →
          </Link>
        ) : null}
      </div>
      {extra ? (
        <div className="w-full pl-9">
          {actions.noBrew && ollama ? <p className="text-body text-muted">Homebrew isn't installed. Download Ollama, then check again.</p> : null}
          {error === null ? null : (
            <p role="alert" className="text-body text-deny">
              {error}
            </p>
          )}
          {ollama ? <Output output={actions.output} running={actions.running === "install"} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Settings → Info › Health: one bordered list with the rows that need fixing first, and the count in the heading. */
export function SetupFormView(props: SetupFormViewProps) {
  const broken = props.rows.filter((row) => row.mark !== "ok");
  const fine = props.rows.filter((row) => row.mark === "ok");
  const heading = useId();
  return (
    <div role="group" aria-labelledby={heading} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 id={heading} className="text-heading font-semibold">
          Health
        </h3>
        <span className="text-meta text-muted">
          {broken.length} to fix · {fine.length} fine
        </span>
      </div>
      <ul aria-labelledby={heading} className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {[...broken, ...fine].map((row) => (
          <Card key={cardKey(row)} {...props} row={row} />
        ))}
      </ul>
    </div>
  );
}

/** A provider that takes an API key, and whether golem has one saved for it. */
export type KeyProvider = { id: string; name: string; blurb: string; saved: boolean };
