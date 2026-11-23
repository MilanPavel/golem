import type { ApprovalChoice } from "@golem/client";

export type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/** The text as one JSON object, or why it is not. */
export function parseArgs(text: string): ParsedArgs {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "the arguments must be one JSON object" };
  }
  return { ok: true, args: value as Record<string, unknown> };
}

/** The edited arguments, or null when they are the call's own and nothing was edited. */
export function editedArgs(
  original: Readonly<Record<string, unknown>>,
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  return JSON.stringify(args) === JSON.stringify(original) ? null : args;
}

/** One way to answer an item: the key, the words, and what goes on the wire. */
export interface ApprovalAnswerOption {
  id: "once" | "session" | "always" | "helper" | "all-helpers" | "deny";
  /** Lower case; "enter" for Enter. */
  key: string;
  shown: string;
  label: string;
  decision: ApprovalChoice;
  /** "batch" for all helpers of the call; left out otherwise. */
  scope?: "batch";
}

/** What the answers depend on: whether a helper asks, and how many helpers are not done. */
export interface ApprovalAnswerContext {
  helper: boolean;
  /** How many helpers ask this same question. */
  count?: number;
  /** How many helpers of the lead are not done, when the caller knows. */
  siblings?: number;
}

/**
 * The answers for one item, in the order they show. A lead's own item: once (Enter), this session (S),
 * always (W), deny (D). A helper's item: once (Enter), this helper (H, `allow_session` in the helper's
 * session), all helpers (T, `allow` with scope "batch"; only when at least two helpers are in play), deny
 * (D). "Always" stays in Tool rules for a helper. Edit (E in the dock, e in the terminal) is the caller's.
 * The terminal also takes `a` for once.
 */
export function approvalAnswerOptions(context: ApprovalAnswerContext): ApprovalAnswerOption[] {
  const once: ApprovalAnswerOption = { id: "once", key: "enter", shown: "\u21b5", label: "Allow once", decision: "allow" };
  const deny: ApprovalAnswerOption = { id: "deny", key: "d", shown: "D", label: "Deny", decision: "deny" };
  if (!context.helper) {
    return [
      once,
      { id: "session", key: "s", shown: "S", label: "For this session", decision: "allow_session" },
      { id: "always", key: "w", shown: "W", label: "Always", decision: "allow_always" },
      deny,
    ];
  }
  const options: ApprovalAnswerOption[] = [
    once,
    { id: "helper", key: "h", shown: "H", label: "For this helper", decision: "allow_session" },
  ];
  const many = Math.max(context.count ?? 1, context.siblings ?? 1);
  if (many >= 2) {
    options.push({ id: "all-helpers", key: "t", shown: "T", label: `For all ${many} helpers`, decision: "allow", scope: "batch" });
  }
  options.push(deny);
  return options;
}

/** The option a key stands for, or null. `key` is `event.key` or the typed letter. */
export function approvalAnswerForKey(options: readonly ApprovalAnswerOption[], key: string): ApprovalAnswerOption | null {
  const lower = key.toLowerCase();
  return options.find((option) => option.key === lower) ?? null;
}

/** The answers an Inbox item offers: none for a consent or an item without a call id. */
export function inboxAnswerOptions(item: {
  kind: "approval" | "consent" | "batch";
  callId: string | null;
  helper: unknown;
  count: number;
}, siblings?: number): ApprovalAnswerOption[] {
  if (item.kind !== "approval" || item.callId === null) return [];
  return approvalAnswerOptions({ helper: item.helper !== null && item.helper !== undefined, count: item.count, siblings });
}

/** Where an answer goes: the helper's session for a helper's item, with the item's call id. Null without a call id. */
export function answerTarget(item: {
  callId: string | null;
  answerSessionId: string;
}): { sessionId: string; callId: string } | null {
  return item.callId === null ? null : { sessionId: item.answerSessionId, callId: item.callId };
}
