import {
  answerTarget,
  inboxAnswerOptions,
  inboxHelperAskWords,
  inboxItems,
  type ApprovalChoice,
  type InboxItem,
  type InboxSession,
} from "@golem/view";

import { HELPERS_KEYS, HELPERS_WHY, type ApprovalLine } from "./approval.ts";
import type { HelperAskAnswer } from "./keys.ts";

/**
 * What a lead waits for when a helper asks (ADR-059): the items of its summary's `pending_items`, one shown at a
 * time. The lead's own approval and paid question keep their bands; a helper's approval gets the band below.
 */
export type HelperDock = {
  /** The lead's items, oldest first: its own and its helpers'. */
  items: InboxItem[];
  /** The one the band shows. */
  index: number;
  item: InboxItem;
};

/** The id of an item, to remember which one is shown. */
export function askKey(item: Pick<InboxItem, "answerSessionId" | "callId">): string {
  return `${item.answerSessionId}:${item.callId ?? "consent"}`;
}

/**
 * The items of the lead's summary, when at least one is a helper's; null otherwise, so an older daemon (only
 * `pending`) and a lead whose helpers ask nothing keep today's band. `picked` is the key of the item the user
 * moved to; it falls back to the oldest when that item is gone.
 */
export function helperDock(summary: InboxSession | undefined, picked: string | null, now: number): HelperDock | null {
  if (summary === undefined) return null;
  const items = inboxItems([summary], now);
  if (!items.some((item) => item.helper !== null)) return null;
  const found = items.findIndex((item) => askKey(item) === picked);
  const index = Math.max(0, found);
  const item = items[index];
  return item === undefined ? null : { items, index, item };
}

/** The key of the item after the shown one, going round. */
export function nextAskKey(dock: HelperDock): string {
  const next = dock.items[(dock.index + 1) % dock.items.length];
  return askKey(next ?? dock.item);
}

/** `1 of 2 · tab next` when two or more wait, else null. */
export function pagerText(dock: HelperDock | null): string | null {
  return dock === null || dock.items.length < 2 ? null : `${String(dock.index + 1)} of ${String(dock.items.length)} · tab next`;
}

/** Whether the shown item is a helper's tool call, which the helper band draws and its keys answer. */
export function isHelperApproval(dock: HelperDock | null): dock is HelperDock {
  return dock !== null && dock.item.helper !== null && dock.item.kind === "approval";
}

/** Whether the shown item is a helper's paid question. */
export function isHelperConsent(dock: HelperDock | null): dock is HelperDock {
  return dock !== null && dock.item.helper !== null && dock.item.kind === "consent";
}

/** The keys line of a helper's approval, from the answers it offers: `a once · h this helper · t all 5 helpers · d deny`. */
function keysLine(item: InboxItem): string {
  return inboxAnswerOptions(item)
    .map((option) => {
      switch (option.id) {
        case "once":
          return "a once";
        case "deny":
          return "d deny";
        default:
          return `${option.key} ${option.label.replace(/^For /, "")}`;
      }
    })
    .join(" · ");
}

function plain(text: string): string {
  return text.replaceAll("`", "");
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * The band of a helper's question: the helper on the first line (with "1 of 2" when several wait), what it asks,
 * the rule that asked and the keys. A paid question shows what is sent and not sent, from the pending item.
 */
export function helperAskLines(dock: HelperDock, columns: number): ApprovalLine[] {
  const width = Math.max(1, columns);
  const item = dock.item;
  const pager = pagerText(dock);
  if (item.kind === "batch") {
    return [
      { text: fit(`Start ${plain(item.headline)}?${pager === null ? "" : ` · ${pager}`}`, width), bold: true, tone: "question" },
      { text: fit(HELPERS_WHY, width), dim: true },
      { text: fit(HELPERS_KEYS, width) },
    ];
  }
  const name = item.helper?.name ?? "A helper";
  const asks = inboxHelperAskWords(item.count);
  const head = fit(`${name} asks${pager === null ? "" : ` · ${pager}`}`, width);
  if (item.kind === "consent") {
    const sent = item.sent.length === 0 ? [] : [`Sent: ${item.sent.join(", ")}`];
    const notSent = item.notSent.length === 0 ? [] : [`Not sent: ${item.notSent.join(", ")}`];
    return [
      { text: head, bold: true, tone: "question" },
      { text: fit(plain(item.headline), width) },
      ...[...sent, ...notSent].map((text) => ({ text: fit(text, width) })),
      { text: fit("opening the helper's question…", width), dim: true },
    ];
  }
  return [
    { text: head, bold: true, tone: "question" },
    { text: fit(plain(item.headline) + (asks === null ? "" : ` · ${asks}`), width) },
    { text: fit(`asked by ${item.source ?? "your rules"}`, width), dim: true },
    { text: fit(keysLine(item), width) },
  ];
}

/** Rows the band wants. */
export function helperAskRows(dock: HelperDock): number {
  return helperAskLines(dock, 1_000).length;
}

/** The call a key sends: the helper's session, the call, the decision and the scope. Null when the answer is not offered. */
export function helperAskAnswer(
  item: InboxItem,
  answer: HelperAskAnswer,
): { sessionId: string; callId: string; decision: ApprovalChoice; scope?: "batch" } | null {
  const target = answerTarget(item);
  const option = inboxAnswerOptions(item).find((candidate) => candidate.id === answer);
  if (target === null || option === undefined) return null;
  return option.scope === undefined ? { ...target, decision: option.decision } : { ...target, decision: option.decision, scope: option.scope };
}
