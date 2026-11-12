import { Button } from "../../ui/button.tsx";
import { PullBar } from "../models/index.ts";
import { StepCard } from "./step-card.tsx";

/** A download the person is waiting on, as the bar draws it. */
export type DownloadLine = { id: string; share: number | null; text: string };

export type ModelStepProps = {
  /** The default model when it is ready to chat, as `provider/name` without the provider. */
  current: string | null;
  /** A download in flight, when there is no default yet. */
  download: DownloadLine | null;
  /** Why the last download failed. */
  failed: string | null;
  /** Opens the model dialog, to pick the default. `from` is the button, for focus afterwards. */
  onChoose: (from: HTMLElement) => void;
  onContinue: () => void;
};

/**
 * Model, as a placeholder until 10.15.8: the page offers the model dialog's list, and goes on
 * once there is a default or a download that will become one. This file is the one that ticket
 * replaces.
 */
export function ModelStep({ current, download, failed, onChoose, onContinue }: ModelStepProps) {
  const ready = current !== null || download !== null;
  const choose = (
    <Button
      size="sm"
      kind={ready ? "secondary" : "ink"}
      onClick={(event) => {
        onChoose(event.currentTarget);
      }}
    >
      {current === null && download === null ? "Choose a model…" : "Change…"}
    </Button>
  );
  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">Pick a model</h2>
      <p className="-mt-2 max-w-md text-balance text-muted">It downloads in the background. You can keep going while it does.</p>
      <ul aria-label="Model" className="flex w-full list-none flex-col gap-2 p-0">
        {current !== null ? (
          <StepCard mark="ok" name="Model" detail={`${current} · default`} fix={choose} />
        ) : download !== null ? (
          <StepCard mark="spin" name="Model" detail={`Downloading ${download.id}`} fix={choose}>
            <PullBar label={`Downloading ${download.id}`} share={download.share} text={download.text} />
          </StepCard>
        ) : (
          <StepCard mark="attn" name="Model" detail="No model chosen yet." fix={choose}>
            {failed === null ? null : (
              <p role="alert" className="text-sm text-deny">
                {failed}
              </p>
            )}
          </StepCard>
        )}
      </ul>
      <div className="flex items-center justify-center gap-2.5">
        <Button kind={ready ? "ink" : "secondary"} disabled={!ready} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}
