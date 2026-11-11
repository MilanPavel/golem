import { SAMPLE_EDIT_DIFF } from "../diff/sample.ts";
import type { ChatMessage, ChatState, ToolBlock } from "@golem/view";

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

/** One tool call in each status, for the gallery and the tests. */
export const SAMPLE_TOOLS: ToolBlock[] = [
  { callId: "t1", name: "read_file", args: { path: "src/socket.ts" }, status: "done", summary: "41 lines", preview: 'import { clamp } from "./clamp";\n\nexport function connect(url: string) {\n  // ...' },
  { callId: "t2", name: "grep", args: { pattern: "Math.min", path: "src" }, status: "done", summary: "2 matches" },
  { callId: "t3", name: "run", args: { command: "pnpm test --filter @golem/client" }, status: "waiting" },
  { callId: "t4", name: "run", args: { command: "just check" }, status: "running", output: "$ just check\nlint ok\ntypes ok\nrunning tests..." },
  { callId: "t5", name: "write_file", args: { path: "/etc/hosts" }, status: "failed", error: "denied" },
  {
    callId: "t6",
    name: "run_shell",
    args: { command: "pnpm test" },
    status: "done",
    summary: "exit 0",
    preview: "> @golem/web test\n 40 tests passed",
    truncated: true,
    artifactId: "art_7f3a",
  },
  {
    callId: "t7",
    name: "edit_file",
    args: { path: "src/socket.ts" },
    status: "done",
    summary: "edited",
    diff: SAMPLE_EDIT_DIFF,
  },
];

const LONG_THINKING = Array.from(
  { length: 40 },
  (_, step) => `Step ${step + 1}: check whether the retry delay can reuse the clamp, then compare it with the meter.`,
).join("\n");

/** Replies with thinking, for the gallery and the tests: streaming, done, none, and a long text. */
export const THINKING_CASES: { label: string; message: ChatMessage; shown?: boolean }[] = [
  {
    label: "streaming",
    message: { id: "k1", role: "assistant", text: "", streaming: true, thinking: "The user wants 17 times 23. I can split it as 17 times 20 plus 17 times 3." },
  },
  {
    label: "done",
    message: {
      id: "k2",
      role: "assistant",
      text: "17 * 23 = 391.",
      streaming: false,
      thinking: "The user wants 17 times 23.\n17 times 20 is 340. 17 times 3 is 51.\n340 plus 51 is 391.",
      thinkingMs: 12_400,
    },
  },
  { label: "no thinking", message: { id: "k3", role: "assistant", text: "The answer is 391.", streaming: false } },
  {
    label: "hidden",
    shown: false,
    message: { id: "k5", role: "assistant", text: "17 * 23 = 391.", streaming: false, thinking: "17 times 20 is 340. 17 times 3 is 51.", thinkingMs: 12_400 },
  },
  {
    label: "long thinking",
    message: { id: "k4", role: "assistant", text: "Done.", streaming: false, thinking: LONG_THINKING, thinkingMs: 95_000 },
  },
];

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
      tools: SAMPLE_TOOLS,
    },
    { id: "u2", role: "user", text: "Now the same for the retry delay.", streaming: false, at: "2026-11-01T14:03:00", skill: { name: "ship" } },
    { id: "a2", role: "assistant", text: "Looking at the retry delay now, which lives in", streaming: true, at: "2026-11-01T14:03:02" },
    { id: "u3", role: "user", text: "Stop.", streaming: false, at: "2026-11-01T14:04:00" },
    { id: "a3", role: "assistant", text: "I had started on the delay when", streaming: false, interrupted: true, at: "2026-11-01T14:04:02", durationMs: 63000 },
  ] satisfies ChatMessage[],
  error: "The model server did not answer.",
  notice: null,
};

/** One run with three tool steps and a final answer: the transcript draws it as one golem with one footer. */
export const TURN_CHAT: Pick<ChatState, "messages" | "error" | "notice"> = {
  messages: [
    { id: "tu", role: "user", text: "Find where the retry delay is set.", streaming: false, at: "2026-11-01T15:00:00" },
    { id: "ts1", role: "assistant", text: "Let me search for it.", streaming: false, durationMs: 2100, tools: [{ callId: "c1", name: "grep", args: { pattern: "retryDelay" }, status: "done", summary: "3 matches" }] },
    { id: "ts2", role: "assistant", text: "", streaming: false, durationMs: 4300, tools: [{ callId: "c2", name: "read_file", args: { path: "src/socket.ts" }, status: "done", summary: "41 lines" }] },
    { id: "ts3", role: "assistant", text: "", streaming: false, durationMs: 6900, tools: [{ callId: "c3", name: "read_file", args: { path: "src/meter.ts" }, status: "done", summary: "28 lines" }] },
    { id: "ts4", role: "assistant", text: "It is set in `socket.ts`, and `meter.ts` only reads it.", streaming: false, durationMs: 8800 },
  ] satisfies ChatMessage[],
  error: null,
  notice: null,
};
