import type { MemoryCounts, MemoryItem, MemorySettings } from "../../../store/memory.ts";

const AT = "2026-11-18T09:00:00+00:00";

/** Memories as the gallery shows them: one of each kind of row. */
export const SAMPLE_MEMORIES: MemoryItem[] = [
  { id: "m_1", scope: "you", title: "I prefer pnpm", text: "I prefer pnpm over npm and yarn.", author: "you", state: "kept", kept_by: "you", always: true, privacy: "chat", created_at: AT, updated_at: AT },
  { id: "m_2", scope: "you", title: "Keep replies short", text: "Keep replies short. No summary at the end.", author: "lead", state: "proposed", privacy: "chat", created_at: AT, updated_at: AT },
  { id: "m_3", scope: "you", title: "My work address", text: "Send work mail to the team alias, not to my own address.", author: "you", state: "kept", kept_by: "you", privacy: "local", usable: false, created_at: AT, updated_at: AT },
  {
    id: "m_4",
    scope: "project",
    folder: "/Users/you/repos/golem",
    title: "Where the retry policy is set",
    text: "The retry policy is set in app/client.py, in RETRY_BACKOFF.",
    author: "helper",
    agent: "explorer",
    state: "stale",
    kept_by: "you",
    privacy: "chat",
    sources: [{ path: "app/client.py", sha256: "0".repeat(64), size: 1200, mtime_ns: 1, checked_at: AT }],
    created_at: AT,
    updated_at: AT,
  },
  { id: "m_5", scope: "history", title: "Fixing the flaky sidebar test", text: "The sidebar test was flaky because it read the list before the daemon answered.", author: "lead", state: "kept", kept_by: "auto", privacy: "chat", created_at: AT, updated_at: AT },
];

export const SAMPLE_MEMORY_COUNTS: MemoryCounts = { you: 3, project: 1, history: 1, proposed: 1, kept: 3, stale: 1 };
export const SAMPLE_MEMORY_SETTINGS: MemorySettings = { you: "chat", projects: "chat", history: "chat" };
