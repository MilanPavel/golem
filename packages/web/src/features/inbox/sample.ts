import { inboxItems, type InboxItem, type InboxSession } from "@golem/view";

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
