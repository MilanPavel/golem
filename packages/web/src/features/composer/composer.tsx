import { collapsePaste, expandPastes, noPastes, prunePastes, type Pastes } from "@golem/view";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "../../ui/cn.ts";
import { SendIcon, StopIcon } from "../../ui/icons.tsx";
import { recall, type History, type Recall } from "./history.ts";
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
  /** Sends the text, long pastes already expanded. A rejection puts the text back. */
  onSend: (text: string) => Promise<unknown>;
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
};

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
  clear = "at-once",
  pending = false,
  busy = false,
  onStop,
  disabledReason = null,
  placeholder = "Message golem",
  label = "Message",
  autoFocus = false,
  describedBy,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const recalled = useRef<Recall | null>(null);
  const caret = useRef<number | "start" | "end" | null>(null);
  const live = useRef({ text, pastes });
  const disabled = disabledReason !== null;

  useEffect(() => {
    live.current = { text, pastes };
  });

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

  async function submit(): Promise<void> {
    const raw = text;
    const sent = expandPastes(raw, pastes);
    if (sent.trim() === "" || pending || disabled) {
      return;
    }
    const savedPastes = pastes;
    history.add(sent);
    recalled.current = null;
    setHint(null);
    if (clear === "at-once") {
      onTextChange("");
      onPastesChange(noPastes);
    }
    try {
      await onSend(sent);
      if (clear === "on-success") {
        onTextChange("");
        onPastesChange(noPastes);
      }
    } catch {
      if (clear === "at-once") {
        const now = live.current.text;
        if (now === "") {
          onTextChange(raw);
          onPastesChange(savedPastes);
        } else {
          onTextChange(`${sent}\n${now}`);
        }
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    const el = event.currentTarget;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (busy) {
        setHint(BUSY_HINT);
      } else {
        void submit();
      }
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
      recalled.current = step.at;
      caret.current = older ? "start" : "end";
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
    recalled.current = null;
    onPastesChange(result.pastes);
    onTextChange(next);
  }

  const large = size === "large";
  const stopping = busy && onStop !== undefined;
  return (
    <div className="flex flex-col gap-1.5">
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
          placeholder={disabledReason ?? placeholder}
          spellCheck
          className={cn(
            "composer-input min-h-6 w-full resize-none border-0 bg-transparent text-base leading-normal text-ink outline-none placeholder:text-faint",
            large && "min-h-12",
          )}
          onChange={(event) => {
            recalled.current = null;
            setHint(null);
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
