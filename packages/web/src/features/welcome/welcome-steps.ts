import { advance, guided, type SetupPanel } from "@golem/view";
import { WELCOME_STEPS, type WelcomeStep } from "../../store/router.ts";

export { WELCOME_STEPS, type WelcomeStep };

export const STEP_NAMES: Record<WelcomeStep, string> = { engine: "Engine", model: "Model", tools: "Tools", ready: "Ready" };

/** What a step shows beside its mark, so colour is never the only sign. */
export type StepState = "done" | "current" | "todo" | "skipped";

export const STEP_WORDS: Record<StepState, string> = { done: "done", current: "current step", todo: "to do", skipped: "skipped" };

/** The panel of the terminal's table that each step stands for. Tools has none: the terminal's window has no such panel. */
const PANEL: Partial<Record<WelcomeStep, SetupPanel>> = { engine: "engine", model: "model", ready: "ready" };

const STEP_OF: Partial<Record<SetupPanel, WelcomeStep>> = {
  engine: "engine",
  ollama: "engine",
  provider: "engine",
  key: "engine",
  model: "model",
  ready: "ready",
};

/**
 * The step after `step`, by the terminal's navigation table (`advance`) where it has one. Engine
 * only offers Continue once an engine is ready, so the table is asked with Ollama running. Tools
 * comes between Model and Ready when it is offered. Null after Ready: the chat.
 */
export function nextStep(step: WelcomeStep, toolsOffered: boolean): WelcomeStep | null {
  if (step === "tools") return "ready";
  const panel = PANEL[step];
  if (panel === undefined) return null;
  const next = advance(guided(panel, "start"), { kind: "done" }, { ollamaRunning: true });
  if (next.kind !== "window" || next.window.view !== "panel") return null;
  const to = STEP_OF[next.window.panel] ?? null;
  return step === "model" && to === "ready" && toolsOffered ? "tools" : to;
}

/** The stepper's states for the page at `step`. Tools is skipped unless it is offered or is the step in view. */
export function stepStates(step: WelcomeStep, toolsOffered: boolean): StepState[] {
  const at = WELCOME_STEPS.indexOf(step);
  return WELCOME_STEPS.map((each, index): StepState => {
    if (each === "tools" && !toolsOffered && each !== step) return "skipped";
    if (index === at) return "current";
    return index < at ? "done" : "todo";
  });
}
