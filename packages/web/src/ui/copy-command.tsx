import { useEffect, useRef, useState } from "react";
import { Button } from "./button.tsx";
import { writeClipboard } from "./clipboard.ts";

const COPIED_MS = 2000;

/** A command in mono with a button that copies it. If the clipboard fails, the text is selected for a manual copy. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const code = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  function copy(): void {
    writeClipboard(command).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_MS);
      },
      () => {
        const node = code.current;
        if (node !== null) {
          try {
            window.getSelection()?.selectAllChildren(node);
          } catch {
            // Nothing more to do: the text is on screen.
          }
        }
      },
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <code ref={code} className="rounded-sm bg-code-bg px-1.5 py-0.5 font-mono text-ink">
        {command}
      </code>
      <Button size="sm" onClick={copy} className="px-2 py-0.5">
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}
