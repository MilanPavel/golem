/**
 * The card on a lead's row (ADR-059): what its helpers that are not done do, so you see it without
 * opening the chat. Pure, so the web card and the TUI switcher say the same thing.
 */

import { formatElapsed } from "./duration.ts";
import { helperSquare, type HelperSession, type HelperSquare } from "./helper-rows.ts";
import { inboxItems, type InboxPending } from "./inbox.ts";
import { queuedWords } from "./wait.ts";

/** The part of a helper's summary the card reads. An older daemon leaves most of it out. */
export interface HelperCardSession extends HelperSession {
  agent?: string | null;
  title?: string | null;
  step?: string | null;
  created_at?: string;
  pending?: InboxPending | null;
}

/** The question a helper asks. `callId` is set for an approval, whose answer buttons the card shows. */
export type HelperAsk = { text: string; callId: string | null };

/** One helper that is not done. */
export type HelperBlock = {
  sessionId: string;
  square: HelperSquare;
  /** `explorer`; `helper` when the daemon names none. */
  agent: string;
  /** The title after the agent type: the label or the first words of the brief. */
  title: string;
  /** `1m 05s` since it started, or null when its start is unreadable. */
  working: string | null;
  /** Why a queued helper waits, in plain words. Null for the others. */
  waiting: string | null;
  /** Its newest step as one line. Null before the first step. */
  step: string | null;
  /** Set when the helper asks you. */
  asks: HelperAsk | null;
};

export type HelperRowCard = {
  /** `2 helpers · 1 asks you`. */
  head: string;
  blocks: HelperBlock[];
};

/** The title without its `<agent> · ` lead. */
function restOfTitle(title: string | null | undefined, agent: string): string {
  const text = (title ?? "").trim();
  const lead = `${agent} · `;
  return text.startsWith(lead) ? text.slice(lead.length).trim() : text;
}

function ask(session: HelperCardSession, now: number): HelperAsk {
  const item = inboxItems([{ session_id: session.session_id, status: "waiting", pending: session.pending }], now)[0];
  if (item === undefined) return { text: "Asks you a question.", callId: null };
  return { text: item.headline.replaceAll("`", ""), callId: item.kind === "approval" ? item.callId : null };
}

/**
 * The card for one lead, from its helper summaries in the order they came. Helpers that are done are
 * left out. Null when none is running or waiting, so a lead with no card shows nothing.
 */
export function helperRowCard(helpers: readonly HelperCardSession[], now: number): HelperRowCard | null {
  const blocks: HelperBlock[] = [];
  for (const session of helpers) {
    const square = helperSquare(session);
    if (square === null) continue;
    const agent = session.agent !== undefined && session.agent !== null && session.agent !== "" ? session.agent : "helper";
    const started = session.created_at === undefined ? Number.NaN : Date.parse(session.created_at);
    const step = session.step?.trim();
    blocks.push({
      sessionId: session.session_id,
      square,
      agent,
      title: restOfTitle(session.title, agent),
      working: Number.isNaN(started) ? null : formatElapsed(now - started),
      waiting: square === "queued" ? queuedWords(session, "web") : null,
      step: step === undefined || step === "" ? null : step,
      asks: square === "asking" ? ask(session, now) : null,
    });
  }
  if (blocks.length === 0) return null;
  const asking = blocks.filter((block) => block.square === "asking").length;
  const head = [
    blocks.length === 1 ? "1 helper" : `${blocks.length} helpers`,
    asking === 0 ? null : asking === 1 ? "1 asks you" : `${asking} ask you`,
  ];
  return { head: head.filter((part): part is string => part !== null).join(" · "), blocks };
}
