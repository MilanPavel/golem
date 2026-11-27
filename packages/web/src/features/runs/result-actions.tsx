import { askAboutResult, resultCopyText } from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { writeClipboard } from "../../ui/clipboard.ts";

const COPIED_MS = 2000;

/**
 * What you can do with one result: Copy it (the text, the path of a file, the address of a link, or a record or
 * table as JSON) and Ask about this, which starts a new chat with the result in its box. Without `onAskAbout`
 * the second is not offered. "Show in Finder" is not here: `fs.reveal` shows only workflow files and folders, so
 * it would refuse the path of a run's output.
 */
export function ResultActions({ title, value, onAskAbout }: { title: string; value: unknown; onAskAbout?: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
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
      {state === "failed" ? (
        <span role="status" className="text-meta text-muted">
          The clipboard is not available here. Select the text and copy it.
        </span>
      ) : null}
    </div>
  );
}
