import { NO_LOCAL_WINDOW, type LocalWindow } from "@golem/view";
import type { RoutingGetResult } from "../../store/routing.ts";
import { DEFAULT_ROUTING, SAMPLE_ROUTING, SAMPLE_ROUTING_ERRORS } from "./routing-sample.ts";

/** A case of the Context page for the gallery: the settings, the errors, and what Auto plans. */
export type ContextCase = {
  label: string;
  values: RoutingGetResult;
  errors: Readonly<Record<string, string>>;
  /** The window the local model gets, and where it comes from. */
  window: LocalWindow;
};

/** What golem plans for the sample Mac. */
export const PLANNED_WINDOW: LocalWindow = { tokens: 32768, source: "golem", estimated: false, reason: null };

const AUTO: RoutingGetResult = { ...DEFAULT_ROUTING, routing: { ...DEFAULT_ROUTING.routing, mode: "auto" } };

/** Settings › Context in the states the page draws, for the gallery. */
export const CONTEXT_CASES: readonly ContextCase[] = [
  { label: "Auto with a hosted model", values: AUTO, errors: {}, window: PLANNED_WINDOW },
  { label: "Fixed", values: SAMPLE_ROUTING, errors: {}, window: { tokens: 16384, source: "fixed", estimated: false, reason: null } },
  {
    label: "Set for this model",
    values: AUTO,
    errors: {},
    window: { tokens: 8192, source: "saved", estimated: false, reason: null },
  },
  {
    label: "From the Modelfile",
    values: AUTO,
    errors: {},
    window: { tokens: 8192, source: "modelfile", estimated: true, reason: "golem could not plan one" },
  },
  {
    label: "Ollama's",
    values: { ...AUTO, context: { ...AUTO.context, window: "ollama" } },
    errors: {},
    window: { tokens: 4096, source: "ollama", estimated: true, reason: null },
  },
  {
    label: "No window, none reported yet",
    values: AUTO,
    errors: {},
    window: { ...NO_LOCAL_WINDOW, reason: "Ollama has not reported this model's size yet" },
  },
  {
    label: "No window, no local model",
    values: { ...AUTO, picked: { local: null, budget: null, frontier: null } },
    errors: {},
    window: NO_LOCAL_WINDOW,
  },
  { label: "Save error", values: AUTO, errors: SAMPLE_ROUTING_ERRORS, window: PLANNED_WINDOW },
];
