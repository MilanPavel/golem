import { emptyChat, type ChatMessage, type ChatState, type HelperRef, type ToolBlock } from "@golem/view";

/** The clock of the samples: a helper that runs started 71 seconds before it. */
export const HELPER_NOW = Date.parse("2026-11-20T10:01:11.000Z");

const BRIEF = "Find where the session token is refreshed and say which file and line.";

const reads: ToolBlock[] = Array.from({ length: 13 }, (_, at) => ({
  callId: `r${String(at)}`,
  name: "read_file",
  args: { path: `src/auth/part${String(at)}.py` },
  status: at === 4 ? "failed" : "done",
}));

const user: ChatMessage = { id: "u1", role: "user", text: BRIEF, streaming: false };

function reply(id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", text, streaming: false, ...extra };
}

const REF: HelperRef = {
  id: "h1",
  index: 0,
  agent: "explorer",
  label: "explorer",
  model: "qwen3:27b",
  startedAt: "2026-11-20T10:00:00.000Z",
  ended: null,
};

/** A second helper of the same batch, for Next helper. */
export const SAMPLE_SECOND_HELPER: HelperRef = { ...REF, id: "h2", index: 1, label: "docs" };

/** A helper that runs: its calls so far, and its newest sentence. */
export const RUNNING_HELPER: { helper: HelperRef; chat: ChatState } = {
  helper: REF,
  chat: {
    ...emptyChat,
    busy: true,
    runId: "rh1",
    messages: [
      user,
      reply("a1", "I read the auth module. The refresh lives near the session class.", { tools: reads, thinking: "Start with auth." }),
      reply("a2", "Checking the callers. It is probably auth/session.py:88.", { thinking: "Check callers." }),
    ],
    notices: [{ id: "n1", afterId: "a1", action: "cleared", text: "golem cleared 11 old tool results", at: "2026-11-20T10:00:30.000Z" }],
  },
};

/** A helper that asks to write a file: its question has answer buttons. */
export const ASKING_HELPER: { helper: HelperRef; chat: ChatState } = {
  helper: REF,
  chat: {
    ...emptyChat,
    busy: true,
    runId: "rh1",
    approval: { callId: "w1", name: "write_file", args: { path: "notes/refresh.md" }, source: "built-in default", diff: null },
    messages: [
      user,
      reply("a1", "I found it. I want to write the finding down.", {
        tools: [...reads, { callId: "w1", name: "write_file", args: { path: "notes/refresh.md" }, status: "waiting", approval: { source: "built-in default", subject: "notes/refresh.md" } }],
      }),
    ],
  },
};

/** The day the sample receipt says its steps were removed. */
export const TRIMMED_AT = "2026-11-19T03:00:00.000Z";

/** A helper whose steps the daemon removed: the brief and the answer are all its own log holds. */
export const TRIMMED_HELPER: { helper: HelperRef; chat: ChatState } = {
  helper: {
    ...REF,
    ended: { stopped: "done", modelCalls: 3, tokens: 14_000, answerTokens: 620, costUsd: 0.01, durationMs: 72_000, workingMs: 70_000 },
  },
  chat: {
    ...emptyChat,
    messages: [user, reply("a2", "The token is refreshed in auth/session.py:88. Nothing else calls it.")],
  },
};

/** A helper that is done: its answer to the lead, and how it ended. */
export const DONE_HELPER: { helper: HelperRef; chat: ChatState } = {
  helper: {
    ...REF,
    ended: { stopped: "done", modelCalls: 3, tokens: 14_000, answerTokens: 620, costUsd: 0.04, durationMs: 72_000, workingMs: 70_000 },
  },
  chat: {
    ...emptyChat,
    messages: [
      user,
      reply("a1", "I read the auth module.", { tools: reads, thinking: "Start with auth." }),
      reply("a2", "The token is refreshed in auth/session.py:88. Nothing else calls it."),
    ],
  },
};
