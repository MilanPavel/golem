import type { ModelMemory, ModelOption, ModelOptionsGetResult } from "../../store/model-options.ts";
import { emptyChat, type TryRun } from "@golem/view";
import type { TryBackend, TuneBackend } from "./tune-view.tsx";

function option(name: string, label: string, kind: ModelOption["kind"], minimum: number, maximum: number, step: number, fallback: number | string | null, short: string, long: string): ModelOption {
  return { name, label, kind, minimum, maximum, step, default: fallback, short, long };
}

/** The daemon's option table, as `model.options.get` sends it. */
export const SAMPLE_OPTIONS: ModelOption[] = [
  option("temperature", "Temperature", "float", 0, 2, 0.05, 0.8, "How adventurous each next word is.", "Low gives nearly the same answer every time, which suits code and facts. High gives more variety, which suits stories and ideas, and more mistakes."),
  option("top_p", "Top P", "float", 0, 1, 0.01, 0.9, "Keeps only the likeliest words that add up to this share.", "At 0.9 the model picks from the smallest set of words that together hold 90% of the chance. Lower is more focused, 1.0 turns the limit off."),
  option("top_k", "Top K", "int", 0, 200, 1, 40, "Picks from only this many likeliest words.", "A small number keeps the answer safe and plain. A large number lets rarer words in. 0 turns the limit off in most models."),
  option("min_p", "Min P", "float", 0, 1, 0.01, 0, "Drops words far less likely than the best one.", "A word must be at least this fraction as likely as the top word to stay. 0.05 cuts the odd words and still leaves room for variety. 0 turns it off."),
  option("repeat_penalty", "Repeat penalty", "float", 0.5, 2, 0.05, 1.1, "How strongly the model avoids repeating itself.", "Above 1 makes words it used recently less likely, which stops loops. Too high makes the text strange. 1.0 turns it off."),
  option("num_ctx", "Context size", "int", 512, 262144, 512, 4096, "How many tokens the model can keep in mind.", "The prompt, the history, and the answer all have to fit. A larger window remembers more of a long chat and costs memory. Past the window the oldest text is dropped."),
  option("num_predict", "Answer length", "int", -2, 32768, 1, -1, "The most tokens one answer may have.", "-1 lets the model run until it is done. -2 fills the context window. A number cuts the answer off there, which caps the time and the cost."),
  option("seed", "Seed", "int", 0, 2 ** 31 - 1, 1, null, "A number that makes the answer repeatable.", "With the same seed, the same prompt, and a temperature, the model gives the same answer. Left empty, each answer starts from a fresh random number."),
  option("keep_alive", "Keep loaded", "duration", -1, 86400, 60, "5m", "How long the model stays in memory after its last answer.", "A loaded model answers at once but holds its memory. A short time frees memory sooner. -1 keeps it loaded until Ollama stops, and 0 unloads it right away."),
];

/** The `think` row of a model that thinks: `off` and `on`, or levels, as the daemon sends it for that model. */
function thinkOption(values: string[]): ModelOption {
  return {
    name: "think",
    label: "Think",
    kind: "choice",
    values,
    default: null,
    short: "Whether the model thinks before it answers.",
    long: "A thinking model writes out its reasoning first. That can give a better answer on a hard question, and it costs time and output tokens. Left unset, the model does what it does by itself. Some models take a level, low, medium, or high, instead of on or off.",
  };
}

/** What `think` takes for a sample model: qwen3.5:4b thinks, gpt-oss:20b takes levels, any other model has no row. */
const SAMPLE_THINK: Record<string, string[]> = {
  "qwen3.5:4b": ["off", "on"],
  "gpt-oss:20b": ["low", "medium", "high"],
};

/** A 16 GB Mac and a 5.2 GB model: 4K fits, 32K is tight, and 128K is too big. */
export const SAMPLE_MEMORY: ModelMemory = { ram_gb: 16, size_gb: 5.2, kv_gb_per_1k_tokens: 0.125, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

/** A model's answer: its own defaults (Ollama's, with a Modelfile temperature), one saved value, no session overrides. */
export function sampleOptionsResult(model: string): ModelOptionsGetResult {
  const think = SAMPLE_THINK[model];
  return {
    model,
    options: think === undefined ? SAMPLE_OPTIONS : [...SAMPLE_OPTIONS, thinkOption(think)],
    defaults: { temperature: 0.6, top_p: 0.9, top_k: 40, min_p: 0, repeat_penalty: 1.1, num_ctx: 4096, num_predict: -1, keep_alive: "5m" },
    saved: { temperature: 0.2 },
    session: {},
    memory: SAMPLE_MEMORY,
  };
}

/** A backend for the gallery: it answers from the sample table and keeps nothing. */
export function sampleTuneBackend(sessionId: string | null = "s_gallery"): TuneBackend {
  return {
    sessionId,
    load: (model) => Promise.resolve(sampleOptionsResult(model)),
    save: (model) => Promise.resolve({ model, saved: {} }),
    setSession: () => Promise.resolve({ session_id: sessionId ?? "", options: {} }),
    watchSaved: () => () => undefined,
    sessionOptions: {},
  };
}

/** A try for the gallery: nothing started, or one that streams, or one that is done. */
export function sampleTry(state: "idle" | "no-question" | "running" | "streaming" | "done" | "failed"): TryBackend {
  const base: TryRun = {
    sessionId: "s_try",
    heading: "try · temperature 0.2 · top_p 0.9",
    original: "A lock that keeps two threads out of the same code.",
    question: "What is a mutex?",
    started: true,
    chat: emptyChat,
  };
  const reply = (text: string, streaming: boolean, error: string | null = null): TryRun => ({
    ...base,
    chat: {
      ...emptyChat,
      busy: streaming,
      error,
      messages: [
        { id: "q", role: "user", text: base.question, streaming: false },
        { id: "a", role: "assistant", text, streaming },
      ],
    },
  });
  const run =
    state === "streaming"
      ? reply("A mutex lets one thread hold a resource", true)
      : state === "done"
        ? reply("A mutex lets one thread hold a resource at a time. The others wait their turn.", false)
        : state === "failed"
          ? reply("", false, "The model did not answer.")
          : null;
  return {
    blocked: state === "no-question" ? "no-question" : state === "running" ? "running" : null,
    plan: () => ({ kind: "refused", reason: "no-question", notice: "Ask something first, then try again." }),
    start: () => Promise.resolve(),
    run,
    open: () => undefined,
  };
}
