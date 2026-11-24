import { useState } from "react";
import type { ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { HuggingFaceIcon } from "../../../ui/hugging-face-icon.tsx";
import { CloseIcon } from "../../../ui/icons.tsx";
import { ProviderIcon } from "../../../ui/provider-icons.tsx";
import { dismissFailed, dismissReady, EMPTY_TRAY, stopTray, trayRows, trayStatus, watchTray, type TrayRow } from "./downloads-tray.ts";

export type GetModelsFootProps = {
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  /** Starts a download again. */
  pull: (ref: string) => Promise<boolean>;
  /** Stops a download. */
  stop: (ref: string) => void;
  /** Back to Ollama's models. */
  onBack: () => void;
};

/**
 * The foot of Get models, a downloads tray: one quiet line with nothing running, else a row for each download.
 * Past two rows it scrolls inside itself, so the page keeps its size. Downloads from the terminal show too.
 */
export function GetModelsFoot({ listing, pulls, pull, stop, onBack }: GetModelsFootProps) {
  const [memory, setMemory] = useState(EMPTY_TRAY);
  const installed = new Set((listing?.models ?? []).filter((model) => model.source === "installed").map((model) => model.ref));
  const next = watchTray(memory, pulls, installed);
  if (next !== memory) setMemory(next);
  const rows = trayRows(next, pulls);

  function row(item: TrayRow) {
    const { ref, name } = item;
    const lead = (
      <>
        <span className="shrink-0">{item.hf ? <HuggingFaceIcon /> : <ProviderIcon provider="ollama" name="Ollama" />}</span>
        <Code className="max-w-64 shrink-0 truncate" title={ref}>
          {name}
        </Code>
      </>
    );
    if (item.kind === "running") {
      const percent = item.share === null ? undefined : Math.floor(item.share * 100);
      return (
        <li key={ref} className="flex items-center gap-3 py-2">
          {lead}
          <div
            role="progressbar"
            aria-label={`Downloading ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-line-strong"
          >
            <div className="h-full rounded-full bg-clay" style={{ width: `${percent ?? 0}%` }} />
          </div>
          <span className="whitespace-nowrap text-meta tabular-nums text-muted">{item.text}</span>
          <Button
            size="sm"
            kind="ghost"
            aria-label={`Cancel the download of ${name}`}
            onClick={() => {
              setMemory(stopTray(next, ref));
              stop(ref);
            }}
          >
            Cancel
          </Button>
        </li>
      );
    }
    if (item.kind === "ready") {
      return (
        <li key={ref} className="flex items-center gap-3 py-2">
          {lead}
          <span className="flex-1 font-semibold text-allow">✓ Ready</span>
          <Button size="sm" onClick={onBack}>
            Show in Ollama
          </Button>
          <Button
            size="sm"
            kind="ghost"
            aria-label={`Dismiss ${name}`}
            onClick={() => {
              setMemory(dismissReady(next, ref));
            }}
          >
            <CloseIcon width="12" height="12" />
          </Button>
        </li>
      );
    }
    return (
      <li key={ref} className="flex items-center gap-3 py-2">
        {lead}
        <span className="min-w-0 flex-1 text-meta text-deny">{`Failed: ${item.words}`}</span>
        <Button
          size="sm"
          onClick={() => {
            void pull(ref);
          }}
        >
          Try again
        </Button>
        <Button
          size="sm"
          kind="ghost"
          aria-label={`Dismiss ${name}`}
          onClick={() => {
            setMemory(dismissFailed(next, ref, item.words));
          }}
        >
          <CloseIcon width="12" height="12" />
        </Button>
      </li>
    );
  }

  return (
    <footer className="shrink-0 border-t border-line text-meta text-faint">
      {/* Said when a download starts, ends or fails, never with each percent. */}
      <div role="status" className="sr-only">
        {trayStatus(rows)}
      </div>
      {rows.length === 0 ? (
        <p className="py-2.5">Downloads show up here. They keep going when you leave.</p>
      ) : (
        <ul aria-label="Downloads" className="max-h-24 divide-y divide-line overflow-y-auto">
          {rows.map(row)}
        </ul>
      )}
    </footer>
  );
}
