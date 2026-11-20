import { inboxGroups, inboxItems, type InboxGroup, type InboxItem, type InboxSession } from "@golem/view";

/** The clock of the samples, so the ages in the gallery do not move. */
export const SAMPLE_NOW = Date.parse("2026-11-16T10:00:00Z");

const SESSIONS: InboxSession[] = [
  {
    session_id: "s1",
    title: "Fix drawer resize jitter",
    status: "waiting",
    pending: { kind: "approval", since: "2026-11-16T09:56:00Z", call_id: "c1", name: "shell", subject: "git push origin main", source: "built-in default" },
  },
  {
    session_id: "s2",
    title: "Move the sidebar to a rail",
    status: "waiting",
    pending: { kind: "approval", since: "2026-11-16T09:30:00Z", call_id: "c2", name: "edit_file", subject: "src/features/sidebar/sidebar.tsx", source: "project rule", added: 12, removed: 4 },
  },
  {
    session_id: "s3",
    title: "Nightly dependency check",
    status: "waiting",
    pending: { kind: "consent", since: "2026-11-16T07:58:00Z", alternatives: 3 },
  },
];

/** Two approvals (a command, an edit with counts) and a consent, oldest first. */
export const SAMPLE_INBOX: InboxItem[] = inboxItems(SESSIONS, SAMPLE_NOW);

const HELPER_ASKS: InboxSession = {
  session_id: "lead",
  title: "Upgrade the dependencies",
  status: "waiting",
  pending_items: [
    {
      kind: "approval",
      since: "2026-11-16T09:50:00Z",
      call_id: "c-lock",
      name: "shell",
      subject: "uv lock --upgrade-package httpx",
      source: "built-in default",
      helper: { session_id: "h1", agent: "worker", label: "upgrade httpx", index: 0 },
      count: 1,
    },
    {
      kind: "approval",
      since: "2026-11-16T09:52:00Z",
      call_id: "c-rm",
      name: "shell",
      subject: "rm -rf build",
      source: "project rule",
      helper: { session_id: "h2", agent: "worker", label: "clean build", index: 1 },
      count: 5,
    },
  ],
};

/** A lead whose helpers ask: one helper's command, and a command five helpers ask. */
export const SAMPLE_HELPER_INBOX: InboxItem[] = inboxItems([HELPER_ASKS], SAMPLE_NOW);

/** The same lead as groups, for the Inbox. */
export const SAMPLE_HELPER_GROUPS: InboxGroup[] = inboxGroups([HELPER_ASKS], SAMPLE_NOW);

/** A helper's paid question, as the pending item carries it. */
export const SAMPLE_HELPER_CONSENT: InboxItem = inboxItems(
  [
    {
      session_id: "lead",
      title: "Upgrade the dependencies",
      status: "waiting",
      pending_items: [
        {
          kind: "consent",
          since: "2026-11-16T09:55:00Z",
          sent: ["the brief"],
          not_sent: ["this chat"],
          helper: { session_id: "h3", agent: "researcher", label: "read the changelog", index: 2 },
        },
      ],
    },
  ],
  SAMPLE_NOW,
)[0]!;
