import { NO_LOCAL_WINDOW, type LocalWindow } from "@golem/view";
import type { RoutingGetResult } from "../../store/routing.ts";
import type { WindowRow } from "./context-window-table.tsx";
import { DEFAULT_ROUTING, SAMPLE_ROUTING, SAMPLE_ROUTING_ERRORS } from "./routing-sample.ts";

/** A case of the Context page for the gallery: the settings, the errors, and what Auto plans. */
export type ContextCase = {
  label: string;
  values: RoutingGetResult;
  errors: Readonly<Record<string, string>>;
  /** The window the local model gets, and where it comes from. */
  window: LocalWindow;
  /** The local models on this Mac and the window each gets, for the table. */
  models: readonly WindowRow[];
};

/** What golem plans for the sample Mac. */
export const PLANNED_WINDOW: LocalWindow = { tokens: 32768, source: "golem", estimated: false, reason: null };

const win = (tokens: number | null, source: LocalWindow["source"], estimated = false, reason: string | null = null): LocalWindow => ({ tokens, source, estimated, reason });

/** Three local models, the first in use, with the windows Auto plans for each. */
export const STILL_WINDOW_ROWS: readonly WindowRow[] = [
  { ref: "ollama/qwen3:8b", name: "qwen3:8b", sizeGb: 5.2, inUse: true, window: win(32768, "golem") },
  { ref: "ollama/gemma4:e4b", name: "gemma4:e4b", sizeGb: 9.6, inUse: false, window: win(16384, "golem") },
  { ref: "ollama/gemma3:4b", name: "gemma3:4b", sizeGb: 3.3, inUse: false, window: win(65536, "golem") },
];

/** The same three under a fixed window: each cut to its maximum, one with a window of its own. */
const FIXED_WINDOW_ROWS: readonly WindowRow[] = [
  { ...STILL_WINDOW_ROWS[0]!, window: win(16384, "fixed") },
  { ...STILL_WINDOW_ROWS[1]!, window: win(16384, "fixed") },
  { ...STILL_WINDOW_ROWS[2]!, window: win(4096, "saved") },
];

/** Ollama's own windows, a forecast. */
const OLLAMA_WINDOW_ROWS: readonly WindowRow[] = STILL_WINDOW_ROWS.map((row) => ({ ...row, window: win(4096, "ollama", true) }));

const AUTO: RoutingGetResult = { ...DEFAULT_ROUTING, routing: { ...DEFAULT_ROUTING.routing, mode: "auto" } };

/** Settings › Context in the states the page draws, for the gallery. */
export const CONTEXT_CASES: readonly ContextCase[] = [
  { label: "Auto with a hosted model", values: AUTO, errors: {}, window: PLANNED_WINDOW, models: STILL_WINDOW_ROWS },
  { label: "Fixed", values: SAMPLE_ROUTING, errors: {}, window: { tokens: 16384, source: "fixed", estimated: false, reason: null }, models: FIXED_WINDOW_ROWS },
  {
    label: "Set for this model",
    values: AUTO,
    errors: {},
    window: { tokens: 8192, source: "saved", estimated: false, reason: null },
    models: STILL_WINDOW_ROWS,
  },
  {
    label: "From the Modelfile",
    values: AUTO,
    errors: {},
    window: { tokens: 8192, source: "modelfile", estimated: true, reason: "golem could not plan one" },
    models: STILL_WINDOW_ROWS,
  },
  {
    label: "Ollama's",
    values: { ...AUTO, context: { ...AUTO.context, window: "ollama" } },
    errors: {},
    window: { tokens: 4096, source: "ollama", estimated: true, reason: null },
    models: OLLAMA_WINDOW_ROWS,
  },
  {
    label: "No window, none reported yet",
    values: AUTO,
    errors: {},
    window: { ...NO_LOCAL_WINDOW, reason: "Ollama has not reported this model's size yet" },
    models: STILL_WINDOW_ROWS,
  },
  {
    label: "No window, no local model",
    values: { ...AUTO, picked: { local: null, budget: null, frontier: null } },
    errors: {},
    window: NO_LOCAL_WINDOW,
    models: [],
  },
  { label: "Save error", values: AUTO, errors: SAMPLE_ROUTING_ERRORS, window: PLANNED_WINDOW, models: STILL_WINDOW_ROWS },
];
