import type { Ref } from "react";
import { Button } from "../../ui/button.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { EngineStep, type EngineStepProps } from "./engine-step.tsx";
import { ModelStep, type ModelStepProps } from "./model-step.tsx";
import { ReadyStep, type ReadyStepProps } from "./ready-step.tsx";
import { Stepper } from "./stepper.tsx";
import { ToolsStep, type ToolsStepProps } from "./tools-step.tsx";
import type { StepState, WelcomeStep } from "./welcome-steps.ts";
import "./welcome.css";

export type WelcomeViewProps = {
  step: WelcomeStep;
  /** The stepper, one state for each of Engine, Model, Tools and Ready. */
  states: readonly StepState[];
  /** Work is running, so the golem's eyes glow. */
  working: boolean;
  /** A line in the `wait` tone above the step, such as the default model that is gone. */
  banner: string | null;
  onStep: (step: WelcomeStep) => void;
  /** `Later`, at any step but Ready. */
  onLater: () => void;
  engine: EngineStepProps;
  model: ModelStepProps;
  tools: ToolsStepProps;
  ready: ReadyStepProps;
  /** The page's root, which takes focus when the step changes, so a keyboard user is not left on a button that went. */
  rootRef?: Ref<HTMLDivElement>;
};

/**
 * The welcome page for one step: the golem, the stepper, and the step's body. It draws what it
 * is given and reads nothing; `WelcomeScreen` wires it to the page.
 */
export function WelcomeView({ step, states, working, banner, onStep, onLater, engine, model, tools, ready, rootRef }: WelcomeViewProps) {
  const first = step === "engine";
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-screen="welcome"
      className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pt-14 pb-10 outline-hidden"
    >
      <div aria-hidden="true" className="welcome-grid pointer-events-none absolute inset-0" />
      <div className="absolute top-3.5 left-4.5 z-10 flex items-center gap-2 text-base font-semibold tracking-tight">
        <PixelGolem state="idle" size="sm" />
        golem
      </div>
      {step === "ready" ? null : (
        <Button kind="ghost" onClick={onLater} className="absolute top-2.5 right-4 z-10">
          Later
        </Button>
      )}
      <div className="relative flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <PixelGolem state={working ? "thinking" : "idle"} size="lg" />
        {first ? (
          <>
            <h1 className="font-prose text-2xl font-normal tracking-tight text-balance">Welcome to golem</h1>
            <p className="-mt-3 font-prose text-muted">Four short steps, then you can chat. About two minutes, plus a download.</p>
          </>
        ) : (
          <h1 className="sr-only">Set up golem</h1>
        )}
        <Stepper states={states} onStep={onStep} />
        {banner === null ? null : (
          <p role="status" className="flex w-full items-start gap-2.5 rounded-md bg-wait-soft px-3 py-2.5 text-left text-sm text-wait">
            <span aria-hidden="true">!</span>
            <span>{banner}</span>
          </p>
        )}
        {step === "engine" ? <EngineStep {...engine} /> : null}
        {step === "model" ? <ModelStep {...model} /> : null}
        {step === "tools" ? <ToolsStep {...tools} /> : null}
        {step === "ready" ? <ReadyStep {...ready} /> : null}
      </div>
    </div>
  );
}
