import type { ModelListResult } from "../../store/models.ts";
import type { RoutingGetResult } from "../../store/routing.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";

const BUDGET = new Set(["openrouter/qwen/qwen3-235b", "groq/llama-3.3-70b"]);

/** The sample model list with its hosted models filed into tiers: two budget, one frontier. */
export const ROUTING_LISTING: ModelListResult = {
  ...SAMPLE_LISTING,
  models: SAMPLE_LISTING.models.map((model) => (BUDGET.has(model.ref) ? { ...model, tier: "budget" as const } : model)),
};

/** Nothing set: every key at its default, and golem's own picks under the ladder. */
export const DEFAULT_ROUTING: RoutingGetResult = {
  routing: { mode: "pinned", paid: "ask", budget_max_price: 1.5, local_only: [] },
  ladder: {},
  roles: { titles: "session", summarise: "session", explore: "session" },
  budget: { over: "local" },
  context: { window: "auto", keep_alive: "30m", reply_reserve: 4096, clear_at: 0.7, clear_to: 0.4, compact_at: 0.85, keep_results: 4, keep_turns: 4 },
  picked: { local: "ollama/qwen3:8b", budget: "openrouter/qwen/qwen3-235b", frontier: null },
};

/** Every table edited: Auto, a named ladder, caps, a job on its own model, two private folders, a fixed window. */
export const SAMPLE_ROUTING: RoutingGetResult = {
  routing: { mode: "auto", paid: "always_ask", budget_max_price: 2, local_only: ["/Users/me/private", "/Users/me/taxes"] },
  ladder: { local: "ollama/gemma4:e4b", budget: "groq/llama-3.3-70b", frontier: "anthropic/claude-sonnet-4" },
  roles: { titles: "ollama/qwen3:8b", summarise: "session", explore: "groq/llama-3.3-70b" },
  budget: { daily_usd: 2, session_usd: 0.5, over: "ask" },
  context: { window: 16384, keep_alive: "30m", reply_reserve: 2048, clear_at: 0.6, clear_to: 0.35, compact_at: 0.8, keep_results: 3, keep_turns: 6 },
  picked: { local: "ollama/qwen3:8b", budget: "openrouter/qwen/qwen3-235b", frontier: null },
};

/** What the daemon sends back for wrong values, by the setting's path. */
export const SAMPLE_ROUTING_ERRORS = {
  "routing.budget_max_price": "Input should be greater than 0",
  "budget.daily_usd": "Input should be greater than or equal to 0",
  "context.clear_to": "[context] needs 0 < clear_to < clear_at < compact_at < 1",
} as const;

/** What Auto gives for the default local model on the sample Mac. */
export const SAMPLE_WINDOW_NOTE = "Auto picks 32K for qwen3:27b on this Mac (36 GB).";

/** A case of the page for the gallery: the settings, the errors, and how wide the page is drawn. */
export type RoutingCase = {
  label: string;
  values: RoutingGetResult;
  errors: Readonly<Record<string, string>>;
  /** What Auto gives for the local model, or null. */
  note: string | null;
  narrow: boolean;
};

const AUTO: RoutingGetResult = { ...DEFAULT_ROUTING, routing: { ...DEFAULT_ROUTING.routing, mode: "auto" } };

/** Settings › Routing in the states the page draws, for the gallery. */
export const ROUTING_CASES: readonly RoutingCase[] = [
  { label: "Auto with limits", values: SAMPLE_ROUTING, errors: {}, note: SAMPLE_WINDOW_NOTE, narrow: false },
  { label: "Auto with no frontier model", values: AUTO, errors: {}, note: SAMPLE_WINDOW_NOTE, narrow: false },
  {
    label: "Paid never",
    values: { ...AUTO, routing: { ...AUTO.routing, paid: "never" } },
    errors: {},
    note: SAMPLE_WINDOW_NOTE,
    narrow: false,
  },
  {
    label: "Local only",
    values: { ...AUTO, routing: { ...AUTO.routing, mode: "local", local_only: ["/Users/me/private"] } },
    errors: {},
    note: SAMPLE_WINDOW_NOTE,
    narrow: false,
  },
  { label: "Pinned", values: DEFAULT_ROUTING, errors: {}, note: SAMPLE_WINDOW_NOTE, narrow: false },
  { label: "Save error", values: AUTO, errors: SAMPLE_ROUTING_ERRORS, note: null, narrow: false },
  { label: "Narrow width", values: SAMPLE_ROUTING, errors: {}, note: SAMPLE_WINDOW_NOTE, narrow: true },
];
