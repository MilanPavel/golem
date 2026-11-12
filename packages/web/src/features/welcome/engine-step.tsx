import { OLLAMA_DOWNLOAD_URL, providerName } from "@golem/view";
import { useEffect, useId, useRef } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { fieldClass } from "../../ui/input.tsx";
import { Output, type KeyProvider } from "../setup/setup-form.tsx";
import type { SetupActionsState } from "../setup/use-setup-actions.ts";
import { StepCard, Working } from "./step-card.tsx";

export type EngineChoice = "local" | "key";

/** Where Ollama is, as the card draws it. `no_brew` has no Homebrew to install it with. */
export type OllamaPhase = "missing" | "installing" | "starting" | "no_brew" | "stopped" | "running";

export type EngineStepProps = {
  choice: EngineChoice;
  onChoice: (choice: EngineChoice) => void;
  ollama: OllamaPhase;
  /** The models Ollama holds, for its line. */
  downloaded: number;
  /** Ollama's version, when the page knows it. The daemon does not send it yet. */
  version?: string | null;
  actions: SetupActionsState;
  onInstall: () => void;
  onCancelInstall: () => void;
  onStart: () => void;
  /** `Check again` of a card; `from` names the card, so the answer shows there. */
  onCheck: (from: string) => void;
  providers: readonly KeyProvider[];
  provider: string;
  onProvider: (id: string) => void;
  /** The engine is ready: Ollama runs, or the chosen provider has its key. */
  ready: boolean;
  onContinue: () => void;
};

const CHOICES: { id: EngineChoice; name: string; detail: string }[] = [
  { id: "local", name: "On this Mac", detail: "Models run on your computer with Ollama. Nothing leaves it. Free." },
  { id: "key", name: "With an API key", detail: "Anthropic, OpenAI and others. Bigger models; you pay per use." },
];

const LINK =
  "rounded-md px-2 py-1 text-sm font-medium text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

function OllamaCard({ props }: { props: EngineStepProps }) {
  const { ollama, actions, onInstall, onCancelInstall, onStart, onCheck, downloaded, version } = props;
  const checking = actions.running === "check" && actions.from === "ollama";
  const error = actions.error === null ? null : actions.error.action === "check" ? (actions.from === "ollama" ? actions.error.text : null) : actions.error.text;
  const alert =
    error === null ? null : (
      <p role="alert" className="text-sm text-deny">
        {error}
      </p>
    );
  switch (ollama) {
    case "running": {
      const have = downloaded === 0 ? "no models yet" : `${downloaded} model${downloaded === 1 ? "" : "s"} downloaded`;
      return <StepCard mark="ok" name="Ollama" detail={["Running", version, have].filter((part) => part !== null && part !== undefined).join(" · ")} />;
    }
    case "installing":
      return (
        <StepCard
          mark="spin"
          name="Ollama"
          detail="Installing with Homebrew…"
          fix={
            <Button size="sm" onClick={onCancelInstall}>
              Stop
            </Button>
          }
        >
          <Output output={actions.output} running />
        </StepCard>
      );
    case "starting":
      return <StepCard mark="spin" name="Ollama" detail="Starting Ollama…" />;
    case "no_brew":
      return (
        <StepCard
          mark="attn"
          name="Ollama"
          detail="Not installed, and Homebrew isn't here to install it."
          fix={
            <>
              <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                Download Ollama ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
              {checking ? (
                <Working>Checking…</Working>
              ) : (
                <Button size="sm" onClick={() => onCheck("ollama")}>
                  Check again
                </Button>
              )}
            </>
          }
        >
          {alert}
        </StepCard>
      );
    case "stopped":
      return (
        <StepCard
          mark="attn"
          name="Ollama"
          detail="Installed, but not running."
          fix={
            <Button size="sm" kind="ink" disabled={actions.running !== null} onClick={onStart}>
              Start Ollama
            </Button>
          }
        >
          {alert}
        </StepCard>
      );
    case "missing":
      return (
        <StepCard
          mark="attn"
          name="Ollama"
          detail="Not installed. golem uses it to run models on this Mac."
          fix={
            <Button size="sm" kind="ink" disabled={actions.running !== null} onClick={onInstall}>
              Install Ollama
            </Button>
          }
        >
          <p className="text-sm text-muted">Installs with Homebrew · about 200 MB</p>
          {alert}
        </StepCard>
      );
  }
}

function KeyCard({ props }: { props: EngineStepProps }) {
  const { providers, provider, onProvider, actions, onCheck } = props;
  const id = useId();
  const chosen = providers.find((item) => item.id === provider) ?? providers[0];
  if (chosen === undefined) return null;
  const checking = actions.running === "check" && actions.from === "key";
  const name = providerName(chosen.id);
  const select = (
    <div className="flex items-center gap-2">
      <label htmlFor={`${id}-provider`} className="sr-only">
        Provider
      </label>
      <select
        id={`${id}-provider`}
        value={chosen.id}
        onChange={(event) => {
          onProvider(event.target.value);
        }}
        className={cn(fieldClass, "w-auto min-w-44")}
      >
        {providers.map((item) => (
          <option key={item.id} value={item.id}>
            {item.saved ? `${item.name} · key saved` : item.name}
          </option>
        ))}
      </select>
    </div>
  );
  if (chosen.saved) {
    return (
      <StepCard mark="ok" name={name} detail="Key saved in your macOS Keychain.">
        {select}
      </StepCard>
    );
  }
  return (
    <StepCard mark="attn" name={name} detail="No key yet. Keys live in your macOS Keychain; the browser never sees them.">
      {select}
      <p className="text-sm text-muted">Run this in a terminal, paste the key when asked:</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyCommand command={`golem auth set ${chosen.id}`} />
        {checking ? (
          <Working>Checking…</Working>
        ) : (
          <Button
            size="sm"
            disabled={actions.running !== null}
            onClick={() => {
              onCheck("key");
            }}
          >
            Check again
          </Button>
        )}
      </div>
      {actions.error?.action === "check" && actions.from === "key" ? (
        <p role="alert" className="text-sm text-deny">
          {actions.error.text}
        </p>
      ) : null}
    </StepCard>
  );
}

/** Engine: how golem thinks. Two choices, the part that goes with the chosen one, and Continue once it is ready. */
export function EngineStep(props: EngineStepProps) {
  const { choice, onChoice, ready, onContinue } = props;
  const next = useRef<HTMLButtonElement>(null);
  // Continue takes focus once the engine is ready, so Enter goes on.
  const wasReady = useRef(false);
  useEffect(() => {
    if (ready && !wasReady.current) next.current?.focus();
    wasReady.current = ready;
  }, [ready]);
  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">How should golem think?</h2>
      <div role="group" aria-label="How golem thinks" className="grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {CHOICES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={choice === item.id}
            onClick={() => {
              onChoice(item.id);
            }}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-md border border-line-strong bg-surface px-3.5 py-3 text-left outline-offset-2 outline-clay focus-visible:outline-2",
              choice === item.id && "border-clay ring-1 ring-clay ring-inset",
            )}
          >
            <span className="font-semibold">{item.name}</span>
            <span className="text-sm text-muted">{item.detail}</span>
          </button>
        ))}
      </div>
      <ul aria-label={choice === "local" ? "Ollama" : "API key"} className="flex w-full list-none flex-col gap-2 p-0">
        {choice === "local" ? <OllamaCard props={props} /> : <KeyCard props={props} />}
      </ul>
      <div className="flex items-center justify-center gap-2.5">
        <Button ref={next} kind={ready ? "ink" : "secondary"} disabled={!ready} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}
