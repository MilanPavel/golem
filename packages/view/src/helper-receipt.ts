import type { ChatState, HelperRef } from "./chat-state.ts";
import { formatTokens } from "./context.ts";
import { formatCost } from "./cost.ts";
import { formatElapsed } from "./duration.ts";
import { helperPanelState, helperSummary } from "./helper-card.ts";
import { helperStopWords } from "./helper.ts";

/** The line above a helper's chat in its own screen: whose it is, what kind, which model, and whether it runs. */
export type HelperBanner = {
  /** The lead's title, or null before it is known. */
  lead: string | null;
  /** The agent type, such as `explorer`. */
  agent: string;
  model: string | null;
  /** True while it works or waits: Stop shows. */
  running: boolean;
};

/**
 * The banner of a helper's chat. The lead's log says the agent, model and how it ended; before the lead's
 * log has arrived, `agent` (from the session list) stands in and the model is unknown.
 */
export function helperBanner(input: { lead: string | null; ref: HelperRef | undefined; chat: ChatState; agent?: string | null }): HelperBanner {
  const { ref, chat } = input;
  const state = ref === undefined ? null : helperPanelState(ref, chat);
  const running = ref === undefined ? chat.busy : state === "running" || state === "waiting";
  const named = input.agent !== undefined && input.agent !== null && input.agent !== "" ? input.agent : "helper";
  return {
    lead: input.lead,
    agent: ref === undefined ? named : ref.agent,
    model: ref === undefined || ref.model === "" ? null : ref.model,
    running,
  };
}

/** What a trimmed helper keeps: the receipt the web and the terminal draw in place of its steps. */
export type HelperReceipt = {
  brief: string | null;
  /** How it ended: `Answered`, `Failed` or `Stopped: time limit`. */
  outcome: string;
  /** Model, tokens, cost and time that the lead's log kept, in that order, as short phrases. */
  facts: string[];
  /** `Steps removed on 2026-11-19`, or null when the date is unknown. */
  removed: string | null;
  /** Where the answer is. */
  answerNote: string;
};

/** The words for a helper that is done. */
function outcomeOf(ref: HelperRef | undefined): string {
  const stopped = ref?.ended?.stopped;
  if (stopped === undefined || stopped === "done") return "Answered";
  if (stopped === "failed") return "Failed";
  const words = helperStopWords(stopped);
  return words === "" ? "Stopped" : words.replace(/^stopped/, "Stopped");
}

/** The day of an ISO time, `2026-11-19`, or null when it is not a date. */
function dayOf(at: string | null): string | null {
  if (at === null) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(at);
  return match === null || Number.isNaN(Date.parse(at)) ? null : match[0];
}

/**
 * The receipt of a trimmed helper, from the lead's `helper.started` and `helper.ended` (`ref`) and the
 * helper's own remaining events (`chat`, which holds the brief and the answer). The client does not know
 * which keep period applied, so it names the day the steps were removed, not a count of days.
 */
export function helperReceipt(input: { ref: HelperRef | undefined; chat: ChatState; trimmedAt: string | null }): HelperReceipt {
  const { ref, chat } = input;
  const end = ref?.ended ?? null;
  const facts = [
    ref === undefined || ref.model === "" ? null : ref.model,
    end === null ? null : `${formatTokens(end.tokens)} tokens`,
    end === null ? null : formatCost(end.costUsd),
    end === null ? null : formatElapsed(end.workingMs),
  ].filter((part): part is string => part !== null && part !== "");
  const day = dayOf(input.trimmedAt);
  return {
    brief: helperSummary(chat).brief,
    outcome: outcomeOf(ref),
    facts,
    removed: day === null ? null : `Steps removed on ${day}`,
    answerNote: "The answer is in the lead's chat.",
  };
}
