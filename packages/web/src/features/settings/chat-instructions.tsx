import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ChatPromptResult } from "../../store/notifications.ts";
import { useChatDefaults, useChatPrompt, useNavigate, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import { instructionTokens, PromptPreview } from "./chat-prompt.tsx";

/** Lines many people use, each one rule in plain words. */
export const COMMON_LINES: readonly string[] = [
  "Be direct. No pleasantries, no praise, no offers at the end.",
  "Keep answers short: the answer first, then stop.",
  "Explain a term the first time you use it.",
  "Say so when you're not sure, instead of guessing.",
  "If a request is unclear, ask one short question first.",
  "Prefer lists and tables to long paragraphs.",
  "Link the sources you used.",
  "Use metric units.",
];

/** How long typing rests before the preview asks again. */
const PREVIEW_DELAY_MS = 400;

type Row = { id: number; text: string };
let lastRowId = 0;
const make = (text: string): Row => ({ id: lastRowId++, text });

const filled = (lines: readonly string[]): string[] => lines.map((line) => line.trim()).filter((line) => line !== "");
const sameLines = (left: readonly string[], right: readonly string[]): boolean => JSON.stringify(filled(left)) === JSON.stringify(filled(right));

export type InstructionsProps = {
  /** The saved lines, from `chat.get`. */
  saved: readonly string[];
  /** Saves the lines with `chat.set`. Resolves to the refusal's words, or null when it was saved. */
  onSave: (lines: string[]) => Promise<string | null>;
  /** Drafts lines from the person's words with `chat.draft`. Rejects with the reason. */
  onDraft: (description: string) => Promise<string[]>;
  /** The lines to preview, once typing rests; null for the saved ones. */
  onPreview: (lines: string[] | null) => void;
  prompt: ChatPromptResult | undefined;
  promptError: string | null;
  /** Opens a link to another page of the app, such as Memory. */
  onNavigate: (href: string) => void;
};

function lineOf(message: string): number | null {
  const found = /\bline (\d+)\b/.exec(message);
  return found === null ? null : Number(found[1]);
}

/** One line of the list: a handle to drag, the text, and ✕. Alt+↑ and Alt+↓ move the line. */
function LineRow({ row, index, count, error, input, onText, onCommit, onRemove, onMove, onDrag }: {
  row: Row;
  index: number;
  count: number;
  error: string | null;
  input: (element: HTMLInputElement | null) => void;
  onText: (text: string) => void;
  onCommit: () => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onDrag: { start: () => void; over: (event: DragEvent) => void; drop: () => void };
}) {
  const errorId = useId();
  const keys = (event: KeyboardEvent): void => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < count) onMove(to);
    }
  };
  return (
    <li onDragOver={onDrag.over} onDrop={onDrag.drop} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          draggable
          role="img"
          aria-label={`Drag line ${index + 1} to move it`}
          onDragStart={onDrag.start}
          className="cursor-grab select-none px-1 text-faint"
        >
          ⠿
        </span>
        <Input
          ref={input}
          aria-label={`Line ${index + 1}`}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          value={row.text}
          onChange={(event) => {
            onText(event.target.value);
          }}
          onBlur={onCommit}
          onKeyDown={(event) => {
            keys(event);
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button size="sm" kind="ghost" aria-label={`Remove line ${index + 1}`} onClick={onRemove}>
          ✕
        </Button>
      </div>
      {error === null ? null : (
        <p id={errorId} role="alert" className="pl-6 text-xs text-deny wrap-anywhere">
          {error}
        </p>
      )}
    </li>
  );
}

/** A line with an Add button, for a draft or a common one. */
function Suggestion({ text, onAdd }: { text: string; onAdd: () => void }) {
  return (
    <li className="flex items-center gap-2 border-t border-dashed border-line py-1.5 first:border-t-0">
      <span className="min-w-0 flex-1 text-sm text-ink wrap-anywhere">{text}</span>
      <Button size="sm" aria-label={`Add “${text}”`} onClick={onAdd}>
        Add
      </Button>
    </li>
  );
}

/**
 * Your instructions: the lines golem adds to the system prompt of every chat, written, drafted or picked, next to what the
 * model reads. A line is saved when its box loses focus, on Enter, after a move and after ✕: there is no Save button.
 */
export function InstructionsView({ saved, onSave, onDraft, onPreview, prompt, promptError, onNavigate }: InstructionsProps) {
  const [rows, setRows] = useState<Row[]>(() => saved.map(make));
  const rowsRef = useRef(rows);
  const lastSaved = useRef<string[]>(filled(saved));
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const focusNext = useRef<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ id: number | null; message: string } | null>(null);
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const id = useId();

  function put(list: Row[]): void {
    rowsRef.current = list;
    setRows(list);
  }

  // A change made elsewhere, such as in the terminal, replaces the lines; our own saves read back the same.
  useEffect(() => {
    if (!sameLines(saved, lastSaved.current)) {
      lastSaved.current = filled(saved);
      put(saved.map(make));
    }
  }, [saved]);

  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [rows]);

  const texts = rows.map((row) => row.text);
  const textsKey = JSON.stringify(texts);
  useEffect(() => {
    const timer = setTimeout(() => {
      onPreview(sameLines(texts, lastSaved.current) ? null : texts);
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `textsKey` stands for `texts`; `onPreview` is not stable.
  }, [textsKey]);

  async function commit(list: Row[] = rowsRef.current): Promise<void> {
    const lines = list.map((row) => row.text);
    if (sameLines(lines, lastSaved.current)) return;
    setError(null);
    const refused = await onSave(lines);
    if (refused === null) {
      lastSaved.current = filled(lines);
      setDone(true);
      return;
    }
    setDone(false);
    const at = lineOf(refused);
    setError({ id: at === null ? null : (list[at - 1]?.id ?? null), message: refused });
  }

  function add(lines: readonly string[]): void {
    const list = [...rowsRef.current.filter((row) => row.text.trim() !== ""), ...lines.map(make)];
    put(list);
    void commit(list);
  }

  function move(from: number, to: number): void {
    const list = [...rowsRef.current];
    const [item] = list.splice(from, 1);
    if (item === undefined) return;
    list.splice(to, 0, item);
    focusNext.current = item.id;
    put(list);
    void commit(list);
  }

  function draft(): void {
    if (drafting) return;
    if (description.trim() === "") {
      setDraftError("Say in a few words how you like answers.");
      return;
    }
    setDrafting(true);
    setDraftError(null);
    onDraft(description.trim())
      .then(setDrafts, (failure: unknown) => {
        setDraftError(actionErrorText(failure, "Could not draft lines."));
      })
      .finally(() => {
        setDrafting(false);
      });
  }

  const have = new Set(filled(texts));
  const offered = (drafts ?? []).filter((line) => !have.has(line.trim()));
  const common = COMMON_LINES.filter((line) => !have.has(line));
  const count = filled(texts).length;

  return (
    <section aria-labelledby={`${id}-head`} data-setting="instructions" className="flex flex-col gap-3">
      <div className="flex max-w-column flex-col gap-1">
        <h3 id={`${id}-head`} className="text-base font-semibold text-ink">
          Your instructions
        </h3>
        <p className="text-sm text-muted">Lines golem puts in the system prompt of every chat, word for word. Empty means nothing is added.</p>
      </div>
      <div className="flex flex-col items-stretch gap-5 chat:flex-row chat:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No instructions. The model answers in its own style.</p>
          ) : (
            <ol aria-label="Your instructions" className="m-0 flex list-none flex-col gap-2 p-0">
              {rows.map((row, index) => (
                <LineRow
                  key={row.id}
                  row={row}
                  index={index}
                  count={rows.length}
                  error={error?.id === row.id ? error.message : null}
                  input={(element) => {
                    if (element === null) inputs.current.delete(row.id);
                    else inputs.current.set(row.id, element);
                  }}
                  onText={(text) => {
                    setDone(false);
                    put(rowsRef.current.map((item) => (item.id === row.id ? { ...item, text } : item)));
                  }}
                  onCommit={() => void commit()}
                  onRemove={() => {
                    const list = rowsRef.current.filter((item) => item.id !== row.id);
                    put(list);
                    void commit(list);
                  }}
                  onMove={(to) => {
                    move(index, to);
                  }}
                  onDrag={{
                    start: () => {
                      dragFrom.current = index;
                    },
                    over: (event) => {
                      if (dragFrom.current !== null) event.preventDefault();
                    },
                    drop: () => {
                      const from = dragFrom.current;
                      dragFrom.current = null;
                      if (from !== null && from !== index) move(from, index);
                    },
                  }}
                />
              ))}
            </ol>
          )}
          {error !== null && error.id === null ? (
            <p role="alert" className="text-xs text-deny wrap-anywhere">
              {error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                const row = make("");
                focusNext.current = row.id;
                put([...rowsRef.current, row]);
              }}
            >
              + Write a line
            </Button>
            <span role="status" aria-live="polite" className="text-xs text-muted">
              {done ? "Saved" : null}
            </span>
          </div>
          <p className="flex justify-between gap-3 border-t border-dashed border-line pt-2 text-xs text-muted">
            <span>
              {count} {count === 1 ? "line" : "lines"} · about {instructionTokens(prompt)} tokens in every chat
            </span>
            <span>Sent top to bottom</span>
          </p>

          <div className="flex flex-col gap-1.5 border-t border-dashed border-line pt-3">
            <h4 className="text-sm font-medium text-ink">Write them with golem</h4>
            <label htmlFor={`${id}-describe`} className="text-xs text-muted">
              Describe how you like answers, in your words
            </label>
            <div className="flex gap-2">
              <Input
                id={`${id}-describe`}
                value={description}
                placeholder="e.g. I teach maths to 12-year-olds; keep it simple and friendly"
                aria-invalid={draftError === null ? undefined : true}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    draft();
                  }
                }}
                className="min-w-0 flex-1"
              />
              <Button onClick={draft} aria-busy={drafting}>
                {drafting ? "Drafting…" : "Draft lines"}
              </Button>
            </div>
            {draftError === null ? null : (
              <p role="alert" className="text-xs text-deny wrap-anywhere">
                {draftError}
              </p>
            )}
            {drafts === null ? null : offered.length === 0 ? (
              <p className="text-xs text-muted">Nothing new here: these lines are in your list already.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <ul aria-label="Drafted lines" className="m-0 flex list-none flex-col p-0">
                  {offered.map((line) => (
                    <Suggestion
                      key={line}
                      text={line}
                      onAdd={() => {
                        add([line]);
                      }}
                    />
                  ))}
                </ul>
                <div>
                  <Button
                    size="sm"
                    onClick={() => {
                      add(offered);
                      setDrafts(null);
                    }}
                  >
                    Add all
                  </Button>
                </div>
              </div>
            )}
          </div>

          <details className="border-t border-dashed border-line pt-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Common ones <span className="font-normal text-muted">a few lines many people use</span>
            </summary>
            <ul aria-label="Common ones" className="m-0 mt-2 flex list-none flex-col p-0">
              {common.map((line) => (
                <Suggestion
                  key={line}
                  text={line}
                  onAdd={() => {
                    add([line]);
                  }}
                />
              ))}
            </ul>
          </details>
        </div>
        <PromptPreview prompt={prompt} error={promptError} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

/** Your instructions from the daemon: `chat.get` for the lines, `chat.set` to save them, `chat.draft`, and `chat.prompt` for the preview. */
export function YourInstructions() {
  const chat = useChatDefaults();
  const actions = usePageActions();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string[] | null>(null);
  const prompt = useChatPrompt(preview, chat.data !== undefined);
  if (chat.isError) {
    return (
      <div role="group" aria-label="Your instructions" className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(chat.error, "Could not read your instructions.")}
        </p>
        <Button size="sm" onClick={() => void chat.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (chat.data === undefined) return <p className="text-body text-muted">loading…</p>;
  return (
    <InstructionsView
      saved={chat.data.instructions}
      onSave={async (lines) => {
        try {
          const result = await actions.setChat({ instructions: lines });
          return result.ok ? null : (result.errors?.[0]?.message ?? "Could not save your instructions.");
        } catch (failure) {
          return actionErrorText(failure, "Could not save your instructions.");
        }
      }}
      onDraft={async (description) => (await actions.draftChat(description)).lines}
      onPreview={setPreview}
      onNavigate={navigate}
      prompt={prompt.data}
      promptError={prompt.isError ? actionErrorText(prompt.error, "Could not read what the model reads.") : null}
    />
  );
}
