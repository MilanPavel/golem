import type { ChatEvent } from "@golem/client";

import { emptyChat, forkPoint, reduceChat, type ChatState } from "./chat-state.ts";
import { differsFromDefault, formatTuneValue, tuneRows, type TuneState, type TuneValue } from "./tune.ts";

/**
 * `/tune` `t`: ask the last question again with the panel's values, in a fork. Pure: the plan, the
 * heading, and the answer folded from the fork's events. The screens do the calls.
 */

export const NO_QUESTION_NOTICE = "Ask something first, then try again.";
export const RUNNING_NOTICE = "Wait for the answer, then try again.";

export type TryPlan =
  | {
      kind: "try";
      /** The message to fork at: the one before the question. Null when the question is the first message. */
      forkAt: string | null;
      /** The panel's values in use, saved and session merged. */
      options: Record<string, TuneValue>;
      /** The question to send again. */
      text: string;
      /** The first line of the original answer, or null when there is none. */
      original: string | null;
    }
  | { kind: "refused"; reason: "no-question" | "running"; notice: string };

/** What to do for `t`, from the chat and the panel. */
export function planTry(chat: Pick<ChatState, "messages" | "busy">, tune: TuneState): TryPlan {
  const { messages } = chat;
  if (chat.busy || messages.some((message) => message.streaming)) {
    return { kind: "refused", reason: "running", notice: RUNNING_NOTICE };
  }
  let index = messages.length - 1;
  while (index >= 0 && !(messages[index]?.role === "user" && messages[index]?.text.trim() !== "")) {
    index -= 1;
  }
  const question = messages[index];
  if (question === undefined) {
    return { kind: "refused", reason: "no-question", notice: NO_QUESTION_NOTICE };
  }
  const answer = messages
    .slice(index + 1)
    .filter((message) => message.role === "assistant" && message.text.trim() !== "")
    .map((message) => message.text)
    .pop();
  return {
    kind: "try",
    forkAt: forkPoint(messages.slice(0, index)),
    options: { ...tune.saved, ...tune.session },
    text: question.text,
    original: answer === undefined ? null : oneLine(answer),
  };
}

/** `try · temperature 0.2 · top_p 0.9`: the values in use that differ from the model's defaults. */
export function tryHeading(tune: TuneState): string {
  const parts = tuneRows(tune)
    .filter((row) => row.value !== null && differsFromDefault(tune, row))
    .map((row) => `${row.option.name} ${formatTuneValue(row.option, row.value)}`);
  return ["try", ...(parts.length > 0 ? parts : ["model defaults"])].join(" · ");
}

/** The fork's name: `try · <the session's title>`, else the start of the question. */
export function tryTitle(title: string | null | undefined, question: string): string {
  const base = title !== null && title !== undefined && title.trim() !== "" ? title.trim() : oneLine(question);
  return `try · ${base.length > 60 ? `${base.slice(0, 59)}…` : base}`;
}

/** A try in progress or done: its fork, what the block says above the answer, and the fork's chat. */
export type TryRun = {
  sessionId: string;
  heading: string;
  original: string | null;
  question: string;
  /** The run on the fork has started. Before that, the fork's history is not the answer. */
  started: boolean;
  chat: ChatState;
};

export function startedTry(sessionId: string, plan: Extract<TryPlan, { kind: "try" }>, heading: string): TryRun {
  return { sessionId, heading, original: plan.original, question: plan.text, started: false, chat: emptyChat };
}

/** Fold one event of the fork into the try. Events of other sessions change nothing. */
export function foldTry(run: TryRun, event: ChatEvent): TryRun {
  if (event.session_id !== run.sessionId) return run;
  return {
    ...run,
    started: run.started || event.type === "run.started",
    chat: reduceChat(run.chat, event),
  };
}

/** The reply to the question so far, with whether it still streams and whether the run failed. */
export function tryAnswer(run: TryRun): { text: string; streaming: boolean; error: string | null } | null {
  if (!run.started) return null;
  const { messages } = run.chat;
  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.role !== "user") {
    index -= 1;
  }
  const replies = messages.slice(index + 1).filter((message) => message.role === "assistant");
  return {
    text: replies.map((message) => message.text).join("\n\n"),
    streaming: run.chat.busy,
    error: run.chat.error,
  };
}

/** Whether the fork's run is still going, and its id for `run.cancel`. */
export function runningTry(run: TryRun): string | null {
  return run.chat.busy ? run.chat.runId : null;
}

function oneLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "") ?? "";
  return line.trim().replace(/\s+/g, " ");
}
