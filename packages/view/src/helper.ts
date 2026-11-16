/** Why a helper ended, as the `delegate` result names it: `explorer finished: <reason>`. */
export type HelperStop = "done" | "calls" | "time" | "budget" | "tokens" | "cancelled";

const STOP_WORDS: Record<Exclude<HelperStop, "done">, string> = {
  calls: "call limit",
  time: "time limit",
  budget: "budget spent",
  tokens: "token limit",
  cancelled: "cancelled",
};

/** The reason a `delegate` result starts with, or `done` when it has none. */
export function helperStop(result: string): string {
  const match = /^explorer finished: (\S+)\n/.exec(result);
  return match?.[1] ?? "done";
}

/** `stopped: time limit` for a helper that hit a limit. Empty when it is `done`. */
export function helperStopWords(stopped: string): string {
  if (stopped === "done" || stopped === "") return "";
  const words = (STOP_WORDS as Record<string, string | undefined>)[stopped] ?? stopped;
  return `stopped: ${words}`;
}
