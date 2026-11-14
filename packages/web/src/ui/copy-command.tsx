import { useEffect, useRef, useState } from "react";
import { cn } from "./cn.ts";
import { writeClipboard } from "./clipboard.ts";
import { IconButton } from "./icon-button.tsx";
import { CheckIcon, CopyIcon } from "./icons.tsx";

const COPIED_MS = 2000;

/**
 * The one copy control: an icon-only ghost button that turns into a check for a moment. `label` says what
 * is copied ("Copy <label>" is the accessible name and tooltip; "Copied" while the check shows). If the
 * clipboard fails, `onFail` runs, for the caller to select the text for a manual copy.
 */
export function CopyButton({ text, label, onFail, className }: { text: string; label: string; onFail?: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  function copy(): void {
    writeClipboard(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_MS);
      },
      () => {
        onFail?.();
      },
    );
  }

  return (
    <IconButton label={copied ? "Copied" : `Copy ${label}`} onClick={copy} className={cn("size-6 shrink-0", className)}>
      {copied ? <CheckIcon className="text-allow" /> : <CopyIcon />}
    </IconButton>
  );
}

/** Selects the text of `node`, for a manual copy after the clipboard failed. */
export function selectText(node: Node | null): void {
  if (node === null) return;
  try {
    window.getSelection()?.selectAllChildren(node);
  } catch {
    // Nothing more to do: the text is on screen.
  }
}

/** A command as a quiet mono chip with the copy icon inside, on the right. */
export function CopyCommand({ command }: { command: string }) {
  const code = useRef<HTMLElement>(null);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-code-bg py-0.5 pr-0.5 pl-2 font-mono text-sm text-muted">
      <code ref={code} className="min-w-0 break-all">
        {command}
      </code>
      <CopyButton
        text={command}
        label={command}
        onFail={() => {
          selectText(code.current);
        }}
      />
    </span>
  );
}
