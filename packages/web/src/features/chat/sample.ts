import type { ChatMessage, ChatState } from "@golem/view";

const CODE = ["```ts", "export function clamp(n: number, lo: number, hi: number): number {", "  // keep n inside the range", '  return Math.min(Math.max(n, lo), hi);', "}", "```"].join("\n");

const ANSWER = [
  "## What changed",
  "",
  "I moved the range check into `clamp`, so every caller shares it:",
  "",
  "- the socket client uses it for the retry delay",
  "- the meter uses it for the percentage",
  "",
  CODE,
  "",
  "| File | Change |",
  "| --- | --- |",
  "| `socket.ts` | uses `clamp` |",
  "| `meter.ts` | uses `clamp` |",
  "",
  "The [design notes](https://example.com/notes) say why.",
].join("\n");

/** A transcript that shows every kind of message, for the gallery and the tests. */
export const SAMPLE_CHAT: Pick<ChatState, "messages" | "error" | "notice"> = {
  messages: [
    { id: "u1", role: "user", text: "Share the range check between the socket client and the meter.", streaming: false, at: "2026-11-01T14:02:00" },
    {
      id: "a1",
      role: "assistant",
      text: ANSWER,
      streaming: false,
      at: "2026-11-01T14:02:09",
      durationMs: 8400,
      tools: [
        { callId: "t1", name: "read_file", args: { path: "src/socket.ts" }, status: "done", summary: "41 lines" },
        { callId: "t2", name: "grep", args: { pattern: "Math.min", path: "src" }, status: "done", summary: "2 matches" },
        { callId: "t3", name: "run", args: { command: "pnpm test --filter @golem/client" }, status: "waiting" },
        { callId: "t4", name: "run", args: { command: "just check" }, status: "running" },
        { callId: "t5", name: "write_file", args: { path: "/etc/hosts" }, status: "failed", error: "denied" },
      ],
    },
    { id: "u2", role: "user", text: "Now the same for the retry delay.", streaming: false, at: "2026-11-01T14:03:00", skill: { name: "ship" } },
    { id: "a2", role: "assistant", text: "Looking at the retry delay now, which lives in", streaming: true, at: "2026-11-01T14:03:02" },
    { id: "u3", role: "user", text: "Stop.", streaming: false, at: "2026-11-01T14:04:00" },
    { id: "a3", role: "assistant", text: "I had started on the delay when", streaming: false, interrupted: true, at: "2026-11-01T14:04:02", durationMs: 63000 },
  ] satisfies ChatMessage[],
  error: "The model server did not answer.",
  notice: null,
};
