import {
  applySuggestion,
  collapsePaste,
  expandPastes,
  moveSuggestion,
  noPastes,
  prunePastes,
  suggest,
  type Pastes,
  type SuggestCommand,
} from "@golem/view";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "../../ui/cn.ts";
import { SendIcon, StopIcon } from "../../ui/icons.tsx";
import { recall, type History, type Recall } from "./history.ts";
import { registerComposer } from "./active-composer.ts";
import { SuggestionList } from "./suggestion-list.tsx";
import "./composer.css";

export const BUSY_HINT = "golem is answering. Press Esc to stop it.";

export type ComposerProps = {
  /** "large" is the centred composer of the empty screen. */
  size?: "dock" | "large";
  text: string;
  onTextChange: (text: string) => void;
  pastes: Pastes;
  onPastesChange: (pastes: Pastes) => void;
  history: History;
  /**
   * Sends the text, long pastes already expanded. A rejection puts the text back. Resolving with
   * "handled" means the text was a command, which history does not keep; "busy" means a run holds
   * it back, so the draft stays and the hint says why.
   */
  onSend: (text: string) => Promise<unknown>;
  /** The slash commands. With them, `/` at the start of the draft suggests them. */
  commands?: readonly SuggestCommand[];
  /** The person changed the draft: typed, pasted, or recalled an older text. */
  onEdit?: () => void;
  /** "at-once" clears the draft when it is sent; "on-success" keeps it on screen until the send worked. */
  clear?: "at-once" | "on-success";
  /** A send is in flight and the composer waits for it. */
  pending?: boolean;
  /** A run is in progress: the send button becomes Stop, and Enter sends nothing. */
  busy?: boolean;
  onStop?: () => void;
  /** Why nothing can be sent, such as no connection. It becomes the placeholder. */
  disabledReason?: string | null;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  describedBy?: string;
  /** The command palette runs its commands in this composer, and fills its draft. */
  forPalette?: boolean;
};

/** A slash command is not held back by a run in progress, but `//` is a message. */
function isCommandLine(text: string): boolean {
  const line = text.trimStart();
  return line.startsWith("/") && !line.startsWith("//");
}

function atEdge(el: HTMLTextAreaElement, edge: "start" | "end", recalling: boolean): boolean {
  if (el.selectionStart !== el.selectionEnd) {
    return false;
  }
  const single = !el.value.includes("\n");
  if (edge === "start") {
    return el.selectionStart === 0 || (recalling && single);
  }
  return el.selectionStart === el.value.length || (recalling && single);
}

/** The message box: a card that turns clay when focused, with the send button inside. */
export function Composer({
  size = "dock",
  text,
  onTextChange,
  pastes,
  onPastesChange,
  history,
  onSend,
  commands,
  onEdit,
  clear = "at-once",
  pending = false,
  busy = false,
  onStop,
  disabledReason = null,
  placeholder = "Message golem",
  label = "Message",
  autoFocus = false,
  describedBy,
  forPalette = false,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const recalled = useRef<Recall | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pick, setPick] = useState<{ draft: string; index: number }>({ draft: "", index: 0 });
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const caret = useRef<number | "start" | "end" | null>(null);
  const live = useRef({ text, pastes });
  const disabled = disabledReason !== null;

  useEffect(() => {
    live.current = { text, pastes };
  });

  const latest = useRef({ onSend, onTextChange, onEdit, onPastesChange, history });
  useEffect(() => {
    latest.current = { onSend, onTextChange, onEdit, onPastesChange, history };
  });

  useEffect(() => {
    if (!forPalette) return;
    return registerComposer({
      run: (line) => latest.current.onSend(line),
      insert: (value) => {
        // The new line replaces the draft, so the old one goes to history: ↑ brings it back.
        const old = expandPastes(live.current.text, live.current.pastes);
        if (old.trim() !== "" && old !== value) latest.current.history.add(old);
        caret.current = "end";
        recalled.current = null;
        setBrowsing(false);
        latest.current.onEdit?.();
        latest.current.onPastesChange(noPastes);
        latest.current.onTextChange(value);
        field.current?.focus();
      },
      focus: () => field.current?.focus(),
    });
  }, [forPalette]);

  useEffect(() => {
    if (autoFocus) {
      field.current?.focus();
    }
  }, [autoFocus]);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (caret.current !== null) {
      const at = caret.current === "start" ? 0 : caret.current === "end" ? el.value.length : caret.current;
      el.setSelectionRange(at, at);
      caret.current = null;
    }
  }, [text]);

  const items = useMemo(
    () =>
      commands === undefined || busy || browsing || pending || disabled || dismissed === text
        ? []
        : suggest(text, commands),
    [commands, busy, browsing, pending, disabled, dismissed, text],
  );
  const open = items.length > 0;
  const selected = pick.draft === text ? Math.min(pick.index, items.length - 1) : 0;
  const activeOption = open ? optionId(selected) : undefined;

  // The same text for the same count, so typing that keeps the count announces nothing.
  const count = open ? `${items.length} ${items.length === 1 ? "suggestion" : "suggestions"}` : "";

  useEffect(() => {
    if (activeOption !== undefined) {
      document.getElementById(activeOption)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeOption]);

  function recalling(next: Recall | null): void {
    recalled.current = next;
    setBrowsing(next !== null);
  }

  /** Puts a suggestion's completion in the draft, with the caret at its end. */
  function complete(index: number, key: "tab" | "enter"): void {
    const result = applySuggestion(text, items, index, key);
    if (result.submit) {
      void submit();
    } else if (result.draft !== text) {
      caret.current = "end";
      recalling(null);
      onEdit?.();
      onTextChange(result.draft);
    }
  }

  async function submit(): Promise<void> {
    const raw = text;
    const sent = expandPastes(raw, pastes);
    if (sent.trim() === "" || pending || disabled) {
      return;
    }
    const savedPastes = pastes;
    recalling(null);
    setHint(null);
    if (clear === "at-once") {
      onTextChange("");
      onPastesChange(noPastes);
    }
    const restore = (): void => {
      if (clear === "at-once") {
        const now = live.current.text;
        if (now === "") {
          onTextChange(raw);
          onPastesChange(savedPastes);
        } else {
          onTextChange(`${sent}\n${now}`);
        }
      }
    };
    try {
      const result = await onSend(sent);
      if (result === "busy") {
        restore();
        setHint(BUSY_HINT);
        return;
      }
      if (result !== "handled") {
        history.add(sent);
      }
      if (clear === "on-success") {
        onTextChange("");
        onPastesChange(noPastes);
      }
    } catch {
      history.add(sent);
      restore();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    const el = event.currentTarget;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (open) {
        complete(selected, "enter");
      } else if (busy && !isCommandLine(text)) {
        setHint(BUSY_HINT);
      } else {
        void submit();
      }
      return;
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      setDismissed(text);
      return;
    }
    if (event.key === "Escape" && busy && onStop) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      setPick({ draft: text, index: moveSuggestion(selected, event.key === "ArrowUp" ? "up" : "down", items.length) });
      return;
    }
    if (open && event.key === "Tab") {
      event.preventDefault();
      complete(selected, "tab");
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const older = event.key === "ArrowUp";
      if (!atEdge(el, older ? "start" : "end", recalled.current !== null)) {
        return;
      }
      const step = recall(history.entries(), recalled.current, older ? "older" : "newer", text);
      if (step === null) {
        return;
      }
      event.preventDefault();
      recalling(step.at);
      caret.current = older ? "start" : "end";
      onEdit?.();
      onTextChange(step.text);
      onPastesChange(noPastes);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pasted = event.clipboardData.getData("text/plain");
    if (pasted === "") {
      return;
    }
    const result = collapsePaste(pastes, pasted);
    if (result.pastes === pastes) {
      return;
    }
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const next = text.slice(0, start) + result.insert + text.slice(el.selectionEnd);
    caret.current = start + result.insert.length;
    recalling(null);
    onEdit?.();
    onPastesChange(result.pastes);
    onTextChange(next);
  }

  const large = size === "large";
  const stopping = busy && onStop !== undefined;
  return (
    <div className="relative flex flex-col gap-1.5">
      {open ? (
        <SuggestionList
          id={listId}
          optionId={optionId}
          items={items}
          selected={selected}
          onPick={(index) => complete(index, "tab")}
        />
      ) : null}
      {commands === undefined ? null : (
        <div aria-live="polite" className="sr-only">
          {count}
        </div>
      )}
      <div
        data-composer={size}
        className={cn(
          "flex flex-col gap-2.5 rounded-xl border border-line-strong bg-surface py-3 pr-3 pl-4 text-left shadow-soft focus-within:border-clay",
          disabled && "opacity-70",
        )}
      >
        <textarea
          ref={field}
          name="message"
          rows={large ? 2 : 1}
          value={text}
          disabled={disabled}
          readOnly={pending}
          aria-busy={pending ? "true" : undefined}
          aria-label={label}
          aria-describedby={describedBy}
          {...(commands === undefined
            ? {}
            : {
                "aria-autocomplete": "list" as const,
                "aria-controls": open ? listId : undefined,
                "aria-activedescendant": activeOption,
              })}
          placeholder={disabledReason ?? placeholder}
          spellCheck
          className={cn(
            "composer-input min-h-6 w-full resize-none border-0 bg-transparent text-base leading-normal text-ink outline-none placeholder:text-faint",
            large && "min-h-12",
          )}
          onChange={(event) => {
            recalling(null);
            setHint(null);
            onEdit?.();
            const value = event.target.value;
            onTextChange(value);
            const kept = prunePastes(value, pastes);
            if (kept !== pastes) {
              onPastesChange(kept);
            }
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="flex items-center justify-end">
          {stopping ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className="grid size-9 place-items-center rounded-md bg-ink text-bg outline-offset-2 outline-clay hover:brightness-110 focus-visible:outline-2"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={disabled || pending || busy || text.trim() === ""}
              onClick={() => void submit()}
              className="grid size-9 place-items-center rounded-md border border-clay bg-clay text-on-clay outline-offset-2 outline-clay hover:brightness-105 focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      {busy && hint !== null ? (
        <p role="status" className="px-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
