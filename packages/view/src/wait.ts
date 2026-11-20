/**
 * The words for a wait, one sentence for each of the seven reasons of ADR-060
 * (section 6). `waitWords` is the only place that writes them, so the web and the
 * TUI say the same thing. The web sentence is the long one, the TUI one the short.
 */

export type WaitReason = "slot" | "load" | "provider" | "team" | "budget" | "you" | "stalled";
export type WaitScope = "call" | "team";
export type WaitLength = "web" | "tui";

/** What the last `model.waiting` event with a `reason` said. Every field is null when the event left it out. */
export type WaitState = {
  reason: WaitReason;
  /** `local:<engine>:<server>:<model>`, `provider:<name>`, `qwen3:14b`, `anthropic` or `shell`. */
  line: string | null;
  /** The model the event named, the name to use when `line` has none. */
  model: string | null;
  /** 1 is next. For `slot` and `provider`. */
  position: number | null;
  /** The label of the call that frees a slot first. */
  holder: string | null;
  /** The backoff left, for `provider`. */
  retryInMs: number | null;
  silentMs: number | null;
  scope: WaitScope | null;
  willRetry: boolean | null;
};

/** What the meter says for a wait from a daemon that sends no `reason`. */
export const WAITING_FOR_LOCAL_MODEL = "waiting for the local model";

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const LOCAL_LINE = /^local:[^:]+:(?:https?:\/\/[^:\s]+(?::\d+)?[^:\s]*|[^:]*):(.+)$/;

/**
 * The name of the model or provider a line stands for, or null when the line has
 * none that can be read. `shell` is not a name here.
 */
export function lineName(line: string | null): string | null {
  const text = line?.trim() ?? "";
  if (text === "" || text === "shell") return null;
  if (text.startsWith("provider:")) {
    const name = text.slice("provider:".length).trim();
    return name === "" ? null : name;
  }
  if (text.startsWith("local:")) {
    const name = LOCAL_LINE.exec(text)?.[1]?.trim();
    return name === undefined || name === "" ? null : name;
  }
  return text;
}

/** `8 s`, or `2 min` from a minute on. Always at least 1 s. */
function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
}

/** The model or provider the wait is on, or `the model` when nothing readable names it. */
function nameOf(wait: WaitState): string {
  if (wait.line?.trim() === "shell") return "the shell";
  return lineName(wait.line) ?? (wait.model !== null && wait.model !== "" ? wait.model : "the model");
}

function queue(wait: WaitState, length: WaitLength): string[] {
  const parts: string[] = [];
  if (wait.position !== null && wait.position >= 1) {
    parts.push(length === "web" ? `${ordinal(wait.position)} in line` : ordinal(wait.position));
  }
  if (wait.holder !== null && wait.holder.trim() !== "") parts.push(`behind ${wait.holder.trim()}`);
  return parts;
}

/** One sentence for a wait with a `reason`. The parts after the first are joined with ` · `, or `, ` for the web queue. */
export function waitWords(wait: WaitState, length: WaitLength): string {
  const name = nameOf(wait);
  const web = length === "web";
  switch (wait.reason) {
    case "slot": {
      const queued = queue(wait, length).join(web ? ", " : " · ");
      return queued === "" ? `waiting for ${name}` : `waiting for ${name} · ${queued}`;
    }
    case "load":
      return `loading ${name}`;
    case "provider": {
      const parts = [`${name} is busy`];
      if (wait.position !== null && wait.position >= 1) parts.push(web ? `${ordinal(wait.position)} in line` : ordinal(wait.position));
      if (wait.retryInMs !== null) parts.push(`${web ? "trying again in" : "again in"} ${seconds(wait.retryInMs)}`);
      return parts.join(" · ");
    }
    case "team":
      return web ? "helpers are at their limit · next when one ends" : "helpers at the limit · next when one ends";
    case "budget":
      return web ? "the spend cap is reached · ask me, or go local" : "spend cap reached · ask me, or go local";
    case "you":
      return web ? "waiting for your answer" : "waiting for you";
    case "stalled": {
      const silent = wait.silentMs === null ? "" : ` for ${seconds(wait.silentMs)}`;
      const subject = wait.scope === "team" ? `nothing has moved in this team${silent}` : `no answer from ${name}${silent}`;
      const then = wait.scope === "team" ? "Stop or Retry" : wait.willRetry === true ? "retrying once" : wait.willRetry === false ? "stopped" : null;
      return then === null ? subject : `${subject} · ${then}`;
    }
  }
}

/** The words for the meter: the sentence for the reason, or the old words when the daemon sent none. */
export function waitText(wait: WaitState | null, length: WaitLength): string {
  return wait === null ? WAITING_FOR_LOCAL_MODEL : waitWords(wait, length);
}
