import type { CostGetResult } from "../../store/cost.ts";

const NONE = { calls: 0, input: 0, output: 0, cost_usd: 0, saved_usd: 0 };

/** A week with local and paid calls, for tests and the gallery. */
export const SAMPLE_USAGE: CostGetResult = {
  today: { calls: 14, input: 212_000, output: 19_000, cost_usd: 0.42, saved_usd: 0.31 },
  week: { calls: 96, input: 1_400_000, output: 120_000, cost_usd: 2.1, saved_usd: 3.4 },
  saved_reference: "deepseek/deepseek-chat",
  by_model: [
    { provider: "anthropic", model: "claude-opus", tier: "frontier", calls: 5, input: 38_000, output: 3_000, cost_usd: 1.91 },
    { provider: "deepseek", model: "deepseek-chat", tier: "budget", calls: 20, input: 240_000, output: 20_000, cost_usd: 0.19 },
    { provider: "ollama", model: "qwen3:27b", tier: "local", calls: 71, input: 1_000_000, output: 100_000, cost_usd: 0 },
  ],
  by_day: [
    { day: "2026-11-09", local_tokens: 100_000, paid_tokens: 0, cost_usd: 0 },
    { day: "2026-11-10", local_tokens: 200_000, paid_tokens: 20_000, cost_usd: 0.1 },
    { day: "2026-11-11", local_tokens: 0, paid_tokens: 0, cost_usd: 0 },
    { day: "2026-11-12", local_tokens: 300_000, paid_tokens: 40_000, cost_usd: 0.6 },
    { day: "2026-11-13", local_tokens: 250_000, paid_tokens: 0, cost_usd: 0 },
    { day: "2026-11-14", local_tokens: 150_000, paid_tokens: 100_000, cost_usd: 1.0 },
    { day: "2026-11-15", local_tokens: 100_000, paid_tokens: 131_000, cost_usd: 0.4 },
  ],
};

/** No call in the week. */
export const EMPTY_USAGE: CostGetResult = { today: NONE, week: NONE, by_model: [], by_day: [] };

/** The same week with the jobs split: the chat, and the helpers (`explore`) that cost a part of it. */
export const SAMPLE_USAGE_WITH_HELPERS: CostGetResult = {
  ...SAMPLE_USAGE,
  by_role: [
    { role: "chat", calls: 70, input: 1_100_000, output: 90_000, cost_usd: 1.6 },
    { role: "explore", calls: 26, input: 300_000, output: 30_000, cost_usd: 0.5 },
  ],
};
