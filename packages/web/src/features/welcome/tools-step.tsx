import { Button } from "../../ui/button.tsx";

/**
 * Whether the Tools step is offered. It is a placeholder until 10.15.9, so the stepper shows it
 * as skipped and Model goes straight to Ready. That ticket replaces this file.
 */
export const TOOLS_OFFERED = false;

export type ToolsStepProps = { onContinue: () => void };

export function ToolsStep({ onContinue }: ToolsStepProps) {
  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">Give golem some tools?</h2>
      <p className="-mt-2 max-w-md text-balance text-muted">Starter tools are not offered here yet. You can add them in Settings.</p>
      <div className="flex items-center justify-center gap-2.5">
        <Button kind="ink" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}
