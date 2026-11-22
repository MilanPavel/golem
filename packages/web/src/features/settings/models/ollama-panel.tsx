import { useState } from "react";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { installLog, type SetupActions } from "../../setup/use-setup-actions.ts";
import { removeText } from "../../models/model-text.ts";
import { fallbackText, isStarred, type OllamaState } from "./derive.ts";
import { ModelTable } from "./models-table.tsx";

const STATE_TEXT: Record<OllamaState, { text: string; dot: string }> = {
  running: { text: "Running", dot: "bg-allow" },
  stopped: { text: "Stopped", dot: "bg-wait" },
  not_installed: { text: "Not installed", dot: "bg-faint" },
};

export type OllamaPanelProps = {
  state: OllamaState | null;
  listing: ModelListResult | null;
  /** Ollama's models: the ones on this Mac and the downloads in flight. */
  models: readonly ListedModel[];
  pulls: PullsSnapshot;
  setup: SetupActions;
  busy: boolean;
  /** Where the last call failed, if it did. */
  error: string | null;
  onStar: (model: ListedModel) => void;
  onRemove: (model: ListedModel) => void;
  onStop: (model: ListedModel) => void;
  onGetModels: () => void;
  onSettings: () => void;
  /** The remove question starts open for this ref. The gallery uses it. */
  initialRemoving?: string | null;
};

/** What the install or the start of Ollama is doing, as one line the person can read. */
function SetupLine({ setup }: { setup: SetupActions }) {
  const { running, error, noBrew, output } = setup.state;
  const log = installLog(output).split("\n").at(-1) ?? "";
  return (
    <>
      {running === "install" ? (
        <p role="status" className="text-sm text-muted">{`Installing Ollama${log === "" ? "…" : `: ${log}`}`}</p>
      ) : running === "start" ? (
        <p role="status" className="text-sm text-muted">
          Starting Ollama…
        </p>
      ) : null}
      {noBrew ? (
        <p className="text-sm text-muted">
          Homebrew is not installed, so golem can&apos;t install Ollama for you. Download it from{" "}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="font-medium text-clay-ink underline underline-offset-4">
            ollama.com/download
          </a>
          , then come back here.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error.text}
        </p>
      )}
    </>
  );
}

/** Ollama's page: its state, its models with ★, size, speed and Remove, its downloads, and the two sheets' buttons. */
export function OllamaPanel({ state, listing, models, pulls, setup, busy, error, onStar, onRemove, onStop, onGetModels, onSettings, initialRemoving = null }: OllamaPanelProps) {
  const [removing, setRemoving] = useState<string | null>(initialRemoving);
  const target = models.find((model) => model.ref === removing) ?? null;
  const working = setup.state.running !== null;
  const shown = state === null ? null : STATE_TEXT[state];
  const defaultName = listing?.default ?? null;
  const starred = models.filter(isStarred).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        {shown === null ? null : (
          <span className="flex items-center gap-1.5">
            <i aria-hidden="true" className={cn("size-2 rounded-full", shown.dot)} />
            <span className="font-medium text-ink">{shown.text}</span>
          </span>
        )}
        <span>{`${starred} of ${models.filter((model) => model.status !== "pulling").length} starred`}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {state === "stopped" ? (
            <Button size="sm" disabled={working} onClick={setup.start}>
              Start Ollama
            </Button>
          ) : null}
          {state === "not_installed" ? (
            working && setup.state.running === "install" ? (
              <Button size="sm" onClick={setup.cancelInstall}>
                Stop the install
              </Button>
            ) : (
              <Button size="sm" disabled={working} onClick={setup.install}>
                Install Ollama
              </Button>
            )
          ) : null}
          <Button size="sm" kind="primary" onClick={onGetModels}>
            Get models
          </Button>
          <Button size="sm" aria-label="Ollama settings" onClick={onSettings}>
            Settings
          </Button>
        </span>
      </div>
      <SetupLine setup={setup} />
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {models.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">
          {state === "not_installed" ? "No models yet. Install Ollama, then use Get models." : "No models on this Mac yet. Use Get models to download one."}
        </p>
      ) : (
        <ModelTable
          label="Models on this Mac"
          models={models}
          defaultName={defaultName}
          local
          pulls={pulls}
          busy={busy}
          onStar={onStar}
          onRemove={(model) => {
            setRemoving(model.ref);
          }}
          onStop={onStop}
        />
      )}
      {target === null || listing === null ? null : (
        <div role="group" aria-label={`Remove ${target.label}`} className="flex flex-col gap-2 rounded-lg bg-wait-soft p-3 text-sm">
          <p>{removeText(target)}</p>
          {fallbackText(listing, target) === "" ? null : <p>{fallbackText(listing, target)}</p>}
          <span className="flex gap-2">
            <Button
              size="sm"
              kind="danger"
              disabled={busy}
              onClick={() => {
                onRemove(target);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setRemoving(null);
              }}
            >
              Keep it
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
