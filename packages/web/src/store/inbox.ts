import { inboxItems, type InboxItem } from "@golem/view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePageActions, useNavigate, useSessionList } from "./page-context.tsx";
import { sendErrorText } from "./errors.ts";
import type { PageActions } from "./page.ts";
import { sessionPath } from "./router.ts";

/** The answers the Inbox gives. "Always allow" stays in the session's own approval card. */
export type InboxChoice = "allow" | "allow_session" | "deny";

/** The id of the approval card of one call, so the Inbox can scroll to it. */
export function approvalCardId(callId: string): string {
  return `approval-${callId}`;
}

/** The id of a session's paid-model question card. */
export const CONSENT_CARD_ID = "consent-card";

const MINUTE = 60_000;
const SCROLL_WAIT = 10_000;

/** The id of an item in the busy and error maps: its session and its call, or the session's consent. */
export function inboxKey(item: Pick<InboxItem, "sessionId" | "callId">): string {
  return `${item.sessionId}:${item.callId ?? "consent"}`;
}

/**
 * Answers an approval through the page's `respond`. It removes nothing: the item leaves when the
 * session's next summary says nothing waits, wherever the answer came from.
 */
export function answerInboxItem(actions: Pick<PageActions, "respond">, sessionId: string, callId: string, choice: InboxChoice): Promise<void> {
  return actions.respond(sessionId, callId, choice);
}

type Doc = Pick<Document, "getElementById" | "body">;

/**
 * Scrolls to the element with `id` once it exists, which is after the session has loaded. Gives up
 * after ten seconds. Returns a function that stops the wait.
 */
export function scrollToCard(id: string, doc: Doc = document): () => void {
  const reveal = (): boolean => {
    const el = doc.getElementById(id);
    if (el === null) return false;
    el.scrollIntoView({ block: "center" });
    return true;
  };
  if (reveal()) return () => undefined;
  const observer = new MutationObserver(() => {
    if (reveal()) stop();
  });
  const timer = setTimeout(() => {
    stop();
  }, SCROLL_WAIT);
  function stop(): void {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(doc.body, { childList: true, subtree: true });
  return stop;
}

/** Goes to the item's session and scrolls to its approval card, or to the consent card. */
export function openInboxItem(item: Pick<InboxItem, "sessionId" | "callId">, navigate: (path: string) => void, doc?: Doc): () => void {
  navigate(sessionPath(item.sessionId));
  return scrollToCard(item.callId === null ? CONSENT_CARD_ID : approvalCardId(item.callId), doc);
}

export type Inbox = {
  items: InboxItem[];
  /** The items whose answer is on its way, by `inboxKey`. */
  busy: Readonly<Record<string, boolean>>;
  /** The line a failed answer left on its card, by `inboxKey`. */
  errors: Readonly<Record<string, string>>;
  answer(item: InboxItem, choice: InboxChoice): void;
  open(item: InboxItem): void;
};

/**
 * What waits for the user, oldest first, from the live session list. The ages are read again once a
 * minute. A busy mark stays until the item leaves; a failed answer clears it and leaves a line.
 */
export function useInbox(): Inbox {
  const list = useSessionList();
  const actions = usePageActions();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, MINUTE);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const items = useMemo(() => inboxItems(list, now), [list, now]);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});

  const live = useMemo(() => new Set(items.map(inboxKey)), [items]);
  const busy = useMemo(() => Object.fromEntries([...sent].filter((key) => live.has(key)).map((key) => [key, true])), [sent, live]);
  const errors = useMemo(() => Object.fromEntries(Object.entries(failed).filter(([key]) => live.has(key))), [failed, live]);

  const answer = useCallback(
    (item: InboxItem, choice: InboxChoice) => {
      if (item.callId === null) return;
      const key = inboxKey(item);
      setSent((current) => new Set(current).add(key));
      setFailed((current) => Object.fromEntries(Object.entries(current).filter(([each]) => each !== key)));
      answerInboxItem(actions, item.sessionId, item.callId, choice).catch((err: unknown) => {
        setSent((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        setFailed((current) => ({ ...current, [key]: sendErrorText(err) }));
      });
    },
    [actions],
  );
  const open = useCallback(
    (item: InboxItem) => {
      openInboxItem(item, navigate);
    },
    [navigate],
  );
  return { items, busy, errors, answer, open };
}
