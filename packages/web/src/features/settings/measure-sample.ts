import type { EvalMeasurement, EvalPlanArm, EvalRun, EvalSummary } from "../../store/evals.ts";
import type { MeasureLive } from "@golem/view";

/** Made-up arms, measurements and numbers for the gallery. Nothing here was measured. */

export const SAMPLE_ARMS: readonly EvalPlanArm[] = [
  { name: "local-32k", label: "Local, 32K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 32768, asks: 10, minutes: 35, verdict: "tight", needed_gb: 21.1, ram_gb: 36, free_gb: 24.3, reason: "It fits, but it takes more than half of the memory. Save your work in other apps first.", choices: [{ ref: "ollama/qwen3.8:27b", size_gb: 18.2 }, { ref: "ollama/qwen3.8:8b", size_gb: 5.2 }] },
  { name: "local-128k", label: "Local, 128K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 131072, asks: 10, minutes: 45, verdict: "too_big", needed_gb: 26.9, ram_gb: 36, free_gb: 24.3, reason: "Does not fit on this Mac with this model. Pick a smaller model for this arm, or leave it out." },
  { name: "budget", label: "Budget cloud", kind: "cloud", tier: "budget", model: "claude-haiku-5-5", window: 32768, asks: 10, minutes: 5, cost_usd: 0.4, reason: "Costs money. Helpers go to the same model or a cheaper one." },
  { name: "frontier", label: "Frontier cloud", kind: "cloud", tier: "frontier", model: "claude-opus-5-5", window: 32768, asks: 10, minutes: 8, cost_usd: 6, reason: "Costs money. Answers the open question: should large reads go to a cheaper model?" },
];

export const SAMPLE_ARMS_NO_ROOM: readonly EvalPlanArm[] = SAMPLE_ARMS.map((arm, at) =>
  at === 0 ? { ...arm, verdict: "no_room" as const, free_gb: 9.8, reason: "Other apps hold 26 GB. Loading the model would make the Mac swap until it stops answering." } : arm,
);

const ASKS = ["Find where a setting is read", "Summarise one file", "Read the whole repo", "Trace a bug across modules", "Compare two designs"];
const WHEN = "2026-11-24T14:02:00";

function runs(played: number, over: "none" | "stopped" = "none"): EvalRun[] {
  const all: EvalRun[] = [];
  let at = 0;
  for (const ask of ASKS) {
    for (const mode of ["off", "on"] as const) {
      const big = ASKS.indexOf(ask) >= 2;
      const base = { arm: "local-32k", ask, mode };
      if (at < played) {
        all.push({ ...base, end: "completed", quality: mode === "on" && big ? 0.9 : 0.8, seconds: mode === "on" && big ? 95 : 70, window_left: mode === "on" && big ? 0.6 : 0.4, helpers_started: mode === "on" && big ? 3 : 0 });
      } else if (at === played && over === "none") {
        all.push({ ...base, end: "running" });
      } else {
        all.push({ ...base, end: over === "stopped" ? "not_run" : "pending" });
      }
      at += 1;
    }
  }
  return all;
}

const ARMS = [{ name: "local-32k", model: "qwen3.8:27b" }];

export const SAMPLE_RUNNING: EvalMeasurement = { id: "m1", arms: ARMS, runs: runs(5), started_at: WHEN, state: "running" };
export const SAMPLE_LIVE: MeasureLive = { id: "m1", index: 6, total: 10, arm: "local-32k", mode: "on", ask: "Read the whole repo", elapsed: 760, memoryUsedGb: 33, memoryTotalGb: 36 };
export const SAMPLE_STOPPED: EvalMeasurement = { id: "m1", arms: ARMS, runs: runs(3, "stopped"), started_at: WHEN, state: "stopped", stop_reason: "Ollama stopped answering." };
export const SAMPLE_DONE: EvalMeasurement = {
  id: "m1",
  arms: ARMS,
  runs: runs(10),
  started_at: WHEN,
  ended_at: "2026-11-24T14:36:10",
  state: "done",
  proposal: {
    pairs: 5,
    wins: 3,
    numbers: [
      { key: "read_share", current: 0.3, proposed: 0.42, measured: true, note: "smallest reading where a helper won" },
      { key: "fill_share", current: 0.85, proposed: 0.8, measured: true, note: "the fullest window that still answered well" },
      { key: "job_share", current: 0.1, proposed: null, measured: false, note: "from the cloud arms only: not measured" },
      { key: "price_ratio", current: 3, proposed: null, measured: false, note: "from the cloud arms only: not measured" },
    ],
  },
};

const line = (over: Partial<EvalSummary>): EvalSummary => ({ id: "x", arms: ARMS, runs_played: 20, runs_total: 20, started_at: "2026-11-21T09:00:00", state: "done", ...over });

export const SAMPLE_HISTORY: readonly EvalSummary[] = [
  line({ id: "b", arms: [{ name: "budget", model: "claude-haiku-5-5" }], cost_usd: 0.38 }),
  line({ id: "s", started_at: "2026-11-20T09:00:00", state: "stopped", runs_played: 3, stop_reason: "You stopped it." }),
];
export const SAMPLE_HISTORY_RUNNING: readonly EvalSummary[] = [line({ id: "m1", started_at: WHEN, state: "running", runs_played: 5, runs_total: 10 }), ...SAMPLE_HISTORY];
