import type { ChatEvent } from "@golem/client";

/** One step of a plan: what golem will do, and the files it will touch. */
export type PlanStepView = { text: string; files: string[] };

/** The newest plan golem proposed. `answered` once a later run has started. */
export type PlanView = {
  planId: string;
  /** The `propose_plan` call the plan came from, so a screen can draw the card at that call. */
  callId: string;
  title: string;
  steps: PlanStepView[];
  answered: boolean;
};

/** Whether the session is in plan first, and the newest plan. */
export type PlanState = { on: boolean; plan: PlanView | null };

export const emptyPlan: PlanState = { on: false, plan: null };

export const PLAN_HINT = "golem only reads, then shows a plan. Nothing changes until you say Build it.";

/** What "Build it" sends after it turns plan first off. */
export const BUILD_TEXT = "Build it. Follow the plan step by step and keep the todo list current.";

/** The name of the tool a plan comes from. */
export const PROPOSE_PLAN_TOOL = "propose_plan";

/** The terminal's hint row while the newest plan waits for an answer. */
export const PLAN_KEYS = "enter build it · type to change the plan";

export function reducePlan(state: PlanState, event: ChatEvent): PlanState {
  switch (event.type) {
    case "session.created":
      return { ...state, on: false };
    case "session.plan.changed":
      return { ...state, on: event.data.on };
    case "plan.proposed":
      return {
        ...state,
        plan: {
          planId: event.data.plan_id,
          callId: event.data.call_id,
          title: event.data.title,
          steps: event.data.steps.map((step) => ({ text: step.text, files: [...(step.files ?? [])] })),
          answered: false,
        },
      };
    case "run.started":
      return state.plan === null || state.plan.answered ? state : { ...state, plan: { ...state.plan, answered: true } };
    default:
      return state;
  }
}

/** The plan that still waits for "Build it", or null. */
export function openPlan(state: PlanState): PlanView | null {
  return state.plan !== null && !state.plan.answered ? state.plan : null;
}

function distinctFiles(steps: readonly PlanStepView[]): number {
  return new Set(steps.flatMap((step) => step.files)).size;
}

/** `3 steps · 3 files`. */
export function planFooter(plan: { steps: readonly PlanStepView[] }): string {
  const steps = plan.steps.length;
  const files = distinctFiles(plan.steps);
  return `${steps} ${steps === 1 ? "step" : "steps"} · ${files} ${files === 1 ? "file" : "files"}`;
}

/** The plan inside the arguments of a `propose_plan` call, or null while they are not whole. */
export function planOfCall(args: Readonly<Record<string, unknown>>): { title: string; steps: PlanStepView[] } | null {
  const { title, steps } = args;
  if (typeof title !== "string" || !Array.isArray(steps)) return null;
  const parsed: PlanStepView[] = [];
  for (const step of steps as unknown[]) {
    if (typeof step !== "object" || step === null) return null;
    const { text, files } = step as { text?: unknown; files?: unknown };
    if (typeof text !== "string") return null;
    parsed.push({ text, files: Array.isArray(files) ? files.filter((file): file is string => typeof file === "string") : [] });
  }
  return { title, steps: parsed };
}

/** The line after `/plan on`, `/plan off` or the palette entry. */
export function planChanged(on: boolean): string {
  return on ? `Plan first is on. ${PLAN_HINT}` : "Plan first is off.";
}

/** The palette entry: what it does when chosen. */
export function planPaletteLabel(on: boolean): string {
  return `Plan first: ${on ? "on" : "off"}`;
}
