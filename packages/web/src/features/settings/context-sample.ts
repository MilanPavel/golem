import type { RoutingGetResult } from "../../store/routing.ts";
import { DEFAULT_ROUTING, SAMPLE_ROUTING, SAMPLE_ROUTING_ERRORS, SAMPLE_WINDOW_NOTE } from "./routing-sample.ts";

/** A case of the Context page for the gallery: the settings, the errors, and what Auto plans. */
export type ContextCase = {
  label: string;
  values: RoutingGetResult;
  errors: Readonly<Record<string, string>>;
  /** What Auto gives for the local model, or null when golem has no plan. */
  note: string | null;
  /** The window Auto plans, in tokens, or null. */
  planned: number | null;
};

const AUTO: RoutingGetResult = { ...DEFAULT_ROUTING, routing: { ...DEFAULT_ROUTING.routing, mode: "auto" } };

/** Settings › Context in the states the page draws, for the gallery. */
export const CONTEXT_CASES: readonly ContextCase[] = [
  { label: "Auto with a hosted model", values: AUTO, errors: {}, note: SAMPLE_WINDOW_NOTE, planned: 32768 },
  { label: "Fixed", values: SAMPLE_ROUTING, errors: {}, note: SAMPLE_WINDOW_NOTE, planned: 32768 },
  {
    label: "Ollama's",
    values: { ...AUTO, context: { ...AUTO.context, window: "ollama" } },
    errors: {},
    note: null,
    planned: null,
  },
  {
    label: "No window",
    values: { ...AUTO, picked: { local: null, budget: null, frontier: null } },
    errors: {},
    note: null,
    planned: null,
  },
  { label: "Save error", values: AUTO, errors: SAMPLE_ROUTING_ERRORS, note: SAMPLE_WINDOW_NOTE, planned: 32768 },
];
