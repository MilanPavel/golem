import { answerTarget, askAboutPostText, inboxCount, inboxGroups, inboxItems, type ApprovalChoice, type InboxGroup, type InboxItem } from "@golem/view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDraft, useInboxPosts, usePageActions, useNavigate, useSessionList } from "./page-context.tsx";
import { NEW_DRAFT_KEY } from "./drafts.ts";
import type { InboxPost } from "./routines.ts";
import { sendErrorText } from "./errors.ts";
import type { PageActions } from "./page.ts";
import { dataPath, sessionPath } from "./router.ts";

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

/** The id of an item in the busy and error maps: the session that answers and its call, or its consent. */
export function inboxKey(item: Pick<InboxItem, "answerSessionId" | "callId">): string {
  return `${item.answerSessionId}:${item.callId ?? "consent"}`;
}

/**
 * Answers an approval through the page's `respond`. It removes nothing: the item leaves when the
 * session's next summary says nothing waits, wherever the answer came from.
 */
export function answerInboxItem(
  actions: Pick<PageActions, "respond">,
  sessionId: string,
  callId: string,
  choice: ApprovalChoice,
  scope?: "batch",
): Promise<void> {
  return scope === undefined ? actions.respond(sessionId, callId, choice) : actions.respond(sessionId, callId, choice, undefined, scope);
}

type Doc = Pick<Document, "getElementById" | "querySelector" | "body">;

/**
 * Scrolls to the element with `id` once it exists, which is after the session has loaded. Gives up
 * after ten seconds. Returns a function that stops the wait.
 */
export function scrollToCard(id: string, doc: Doc = document): () => void {
  return scrollToElement(() => doc.getElementById(id), doc);
}

/** Scrolls to what `find` finds, now or once it is drawn, giving up after a few seconds. */
function scrollToElement(find: () => Element | null, doc: Doc): () => void {
  const reveal = (): boolean => {
    const el = find();
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

/** The selector of a saved query's row on its source's Queries tab, so an Inbox post can scroll to it. A row has no id: the same query can show in more than one place, and a name may hold spaces. */
export function queryRowSelector(name: string): string {
  return `[data-query="${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
}

/** Goes to the Queries tab of the post's source and scrolls to the query's row. */
export function openInboxPostQuery(post: Pick<InboxPost, "source" | "saved">, navigate: (path: string) => void, doc: Doc = document): () => void {
  navigate(dataPath(post.source, "queries"));
  return scrollToElement(() => doc.querySelector(queryRowSelector(post.saved)), doc);
}

export type Inbox = {
  /** What query routines left: their first rows, or the error they hit. Newest first. */
  posts: InboxPost[];
  /** Marks a post done, so it leaves the Inbox. */
  donePost(post: InboxPost): void;
  /** Opens the post's query on its source's Queries tab. */
  openPost(post: InboxPost): void;
  /** Starts a chat with the post in the draft. */
  askPost(post: InboxPost): void;
  /** The line a failed Done left on its post, by `post_id`. */
  postErrors: Readonly<Record<string, string>>;
  items: InboxItem[];
  /** The items by lead, the lead with the oldest item first. */
  groups: InboxGroup[];
  /** How many askers wait: a question several helpers ask counts once for each. */
  count: number;
  /** The items whose answer is on its way, by `inboxKey`. */
  busy: Readonly<Record<string, boolean>>;
  /** The line a failed answer left on its card, by `inboxKey`. */
  errors: Readonly<Record<string, string>>;
  /** Answers to the item's target: the helper's session for a helper's item. `scope: "batch"` is all helpers. For a batch item `allow` runs the helpers and `deny` does the work in the chat. */
  /** `cheaper` is for a batch: Start on the item's cheaper model. */
  answer(item: InboxItem, choice: ApprovalChoice, scope?: "batch", cheaper?: boolean): void;
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
  const groups = useMemo(() => inboxGroups(list, now), [list, now]);
  const found = useInboxPosts();
  const posts = useMemo(() => found.data?.posts ?? [], [found.data]);
  const [, setDraft] = useDraft(NEW_DRAFT_KEY);
  const [postErrors, setPostErrors] = useState<Readonly<Record<string, string>>>({});
  const donePost = useCallback(
    (post: InboxPost) => {
      setPostErrors((current) => Object.fromEntries(Object.entries(current).filter(([each]) => each !== post.post_id)));
      actions.doneInboxPost(post.post_id).catch((err: unknown) => {
        setPostErrors((current) => ({ ...current, [post.post_id]: sendErrorText(err) }));
      });
    },
    [actions],
  );
  const openPost = useCallback(
    (post: InboxPost) => {
      openInboxPostQuery(post, navigate);
    },
    [navigate],
  );
  const askPost = useCallback(
    (post: InboxPost) => {
      setDraft(askAboutPostText(post));
      navigate("/");
    },
    [navigate, setDraft],
  );
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});

  const live = useMemo(() => new Set(items.map(inboxKey)), [items]);
  const busy = useMemo(() => Object.fromEntries([...sent].filter((key) => live.has(key)).map((key) => [key, true])), [sent, live]);
  const errors = useMemo(() => Object.fromEntries(Object.entries(failed).filter(([key]) => live.has(key))), [failed, live]);

  const answer = useCallback(
    (item: InboxItem, choice: ApprovalChoice, scope?: "batch", cheaper?: boolean) => {
      const target = answerTarget(item);
      if (target === null) return;
      const key = inboxKey(item);
      setSent((current) => new Set(current).add(key));
      setFailed((current) => Object.fromEntries(Object.entries(current).filter(([each]) => each !== key)));
      // A batch of helpers is answered with `helpers.respond`: Run is a yes, "Do it in the chat" a no.
      const sending =
        item.kind === "batch"
          ? cheaper === true
            ? actions.respondHelpers(target.sessionId, target.callId, true, true)
            : actions.respondHelpers(target.sessionId, target.callId, choice !== "deny")
          : answerInboxItem(actions, target.sessionId, target.callId, choice, scope);
      sending.catch((err: unknown) => {
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
  const count = useMemo(() => inboxCount(items) + posts.length, [items, posts]);
  return { posts, donePost, openPost, askPost, postErrors, items, groups, count, busy, errors, answer, open };
}
