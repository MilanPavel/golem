import type { ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { PullBar } from "../models/index.ts";
import { AppCard, type AppCardProps } from "../setup/index.ts";
import { StepMark, type CardMark } from "./step-card.tsx";

/** What the Model line of the summary says. */
export type ReadyModel =
  | { kind: "ready"; text: string }
  | { kind: "downloading"; id: string; share: number | null; text: string }
  | { kind: "failed"; text: string }
  | { kind: "none" };

export type ReadyStepProps = {
  /** `Ollama on this Mac`, or the provider with an API key. */
  engine: string;
  model: ReadyModel;
  /** What the Tools step set up, or `skipped`. */
  tools: string;
  /** Whether the tools line is a step that was left out. */
  toolsSkipped: boolean;
  /**
   * The service is not kept at login, or the page's host is not: say how to keep them. Never
   * blocks. `page: "only"` is the page's host alone, the service being kept already.
   */
  keepNote: { command: string; page?: "only" } | null;
  /** The offer to install the page as an app, under the button. */
  app: Omit<AppCardProps, "where">;
  /** The person came from a send that had no model: the button goes back to their message. */
  fromSend: boolean;
  onStart: () => void;
};

function Line({ mark, name, waitWord, children }: { mark: CardMark; name: string; waitWord?: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <StepMark mark={mark} {...(waitWord === undefined ? {} : { waitWord })} />
      <span>{name}</span>
      <span className="ml-auto text-right font-mono text-muted">{children}</span>
    </li>
  );
}

const MODEL_MARK: Record<ReadyModel["kind"], CardMark> = { ready: "ok", downloading: "spin", failed: "fail", none: "attn" };

/** Ready: what was set up, and the way into the chat. While the default model downloads it says `Almost ready.` and waits. */
export function ReadyStep({ engine, model, tools, toolsSkipped, keepNote, app, fromSend, onStart }: ReadyStepProps) {
  const waiting = model.kind === "downloading";
  const lede = [
    waiting ? `${model.id} is still downloading. Start chatting turns on when it's there.` : null,
    fromSend ? "Your message is waiting where you left it. Nothing has been sent." : null,
  ].filter((part) => part !== null);
  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">{waiting ? "Almost ready." : "golem is ready."}</h2>
      {lede.length === 0 ? null : <p className="-mt-2 max-w-md text-balance text-muted">{lede.join(" ")}</p>}
      <ul aria-label="What was set up" className="flex w-full list-none flex-col gap-2 p-0 text-left">
        <Line mark="ok" name="Engine">
          {engine}
        </Line>
        <Line mark={MODEL_MARK[model.kind]} name="Model">
          {model.kind === "ready" ? (
            model.text
          ) : model.kind === "downloading" ? (
            <PullBar label={`Downloading ${model.id}`} share={model.share} text={model.text} />
          ) : model.kind === "failed" ? (
            model.text
          ) : (
            "none chosen yet"
          )}
        </Line>
        <Line mark={toolsSkipped ? "wait" : "ok"} name="Tools" waitWord="skipped">
          {tools}
        </Line>
      </ul>
      <div className="flex items-center justify-center gap-2.5">
        <Button kind="ink" disabled={waiting} onClick={onStart}>
          {fromSend ? "Back to your message" : "Start chatting"}
        </Button>
      </div>
      <AppCard {...app} where="ready" />
      {keepNote === null ? null : (
        <div className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-3.5 py-3 text-sm text-muted">
          <p>
            {keepNote.page === "only"
              ? "This page stops when you close the terminal window. To keep it running, even after a restart:"
              : "golem and this page stop when you close the terminal window. To keep them running, even after a restart:"}
          </p>
          <CopyCommand command={keepNote.command} />
        </div>
      )}
    </>
  );
}
