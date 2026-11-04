import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { writeClipboard } from "./copy-text.ts";

/** One line under the composer: what a command did, or where to find what the page lacks. */
export type CommandNotice = {
  text: string;
  /** A command to run in a terminal, shown in mono with a Copy button. */
  command?: string;
};

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

/** The notice as a status line, muted. */
export function NoticeLine({ notice }: { notice: CommandNotice }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted">
      <span>{notice.text}</span>
      {notice.command === undefined ? null : <CopyCommand command={notice.command} />}
    </p>
  );
}
