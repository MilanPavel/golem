import { cn } from "../../ui/cn.ts";
import { STEP_NAMES, STEP_WORDS, WELCOME_STEPS, type StepState, type WelcomeStep } from "./welcome-steps.ts";

const WORD_TONE: Record<StepState, string> = {
  done: "text-allow",
  current: "text-clay-ink",
  todo: "text-faint",
  skipped: "text-faint",
};

/** Engine, Model, Tools, Ready, each with its word as well as its mark. A done step is a button back to it. */
export function Stepper({ states, onStep }: { states: readonly StepState[]; onStep: (step: WelcomeStep) => void }) {
  return (
    <ol aria-label="Setup steps" className="flex items-start justify-center gap-1.5">
      {WELCOME_STEPS.map((step, index) => {
        const state = states[index] ?? "todo";
        const name = STEP_NAMES[step];
        return (
          <li key={step} className="contents">
            {index === 0 ? null : (
              <span aria-hidden="true" className="pt-px text-faint">
                →
              </span>
            )}
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex min-w-14 flex-col items-center gap-1 border-b-2 border-transparent px-1 pb-1.5 sm:min-w-18",
                state === "current" && "border-clay",
              )}
            >
              {state === "done" ? (
                <button
                  type="button"
                  aria-label={`${name}, done. Go back to it`}
                  onClick={() => {
                    onStep(step);
                  }}
                  className="cursor-pointer rounded-sm font-semibold underline decoration-line-strong underline-offset-4 outline-offset-2 outline-clay focus-visible:outline-2"
                >
                  {name}
                </button>
              ) : (
                <span className={cn("font-semibold", (state === "todo" || state === "skipped") && "text-faint", state === "skipped" && "line-through decoration-line-strong")}>
                  {name}
                </span>
              )}
              <span className={cn("font-mono text-xs leading-none", WORD_TONE[state])}>{STEP_WORDS[state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
