import { useEffect, useRef, useState } from "react";
import { Button } from "./button.tsx";
import { writeClipboard } from "./clipboard.ts";

const COPIED_MS = 2000;

/**
 * A small Copy button for `text`. It says Copied for a moment. If the clipboard fails, `onFail`
 * runs, for the caller to select the text for a manual copy. `label` is the accessible name while it says Copy.
 */
export function CopyButton({ text, label, onFail }: { text: string; label?: string; onFail?: () => void }) {
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
    <Button size="sm" onClick={copy} className="px-2 py-0.5" aria-label={copied || label === undefined ? undefined : label}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** A command in mono with a button that copies it. If the clipboard fails, the text is selected for a manual copy. */
export function CopyCommand({ command }: { command: string }) {
  const code = useRef<HTMLElement>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <code ref={code} className="rounded-sm bg-code-bg px-1.5 py-0.5 font-mono text-ink">
        {command}
      </code>
      <CopyButton
        text={command}
        onFail={() => {
          const node = code.current;
          if (node !== null) {
            try {
              window.getSelection()?.selectAllChildren(node);
            } catch {
              // Nothing more to do: the text is on screen.
            }
          }
        }}
      />
    </span>
  );
}
