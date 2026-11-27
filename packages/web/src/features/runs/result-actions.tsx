import { askAboutResult, resultCopyText } from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { revealErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { writeClipboard } from "../../ui/clipboard.ts";

const COPIED_MS = 2000;

/**
 * What you can do with one result: Copy it (the text, the path of a file, the address of a link, or a record or
 * table as JSON), Ask about this, which starts a new chat with the result in its box, and, for a file, Show in
 * Finder. Without `onAskAbout` or `onReveal` the action is not offered. A refusal of Show in Finder (the page is
 * not on the Mac that runs golem, the file is gone) is said beside the button; the button stays.
 */
export function ResultActions({ title, value, onAskAbout, onReveal }: { title: string; value: unknown; onAskAbout?: (text: string) => void; onReveal?: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [refused, setRefused] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  function copy(): void {
    const settle = (next: "copied" | "failed") => {
      setState(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), COPIED_MS);
    };
    writeClipboard(resultCopyText(value)).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  }
  function reveal(): void {
    if (onReveal === undefined) return;
    setRefused(null);
    onReveal().catch((error: unknown) => setRefused(revealErrorText(error)));
  }
  return (
    <div role="group" aria-label={`Actions for ${title}`} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Button size="sm" onClick={copy}>
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      {onAskAbout === undefined ? null : (
        <Button size="sm" onClick={() => onAskAbout(askAboutResult(title, value))}>
          Ask about this
        </Button>
      )}
      {onReveal === undefined ? null : (
        <Button size="sm" onClick={reveal}>
          Show in Finder
        </Button>
      )}
      {refused === null ? null : (
        <span role="status" className="text-meta text-muted">
          {refused}
        </span>
      )}
      {state === "failed" ? (
        <span role="status" className="text-meta text-muted">
          The clipboard is not available here. Select the text and copy it.
        </span>
      ) : null}
    </div>
  );
}
