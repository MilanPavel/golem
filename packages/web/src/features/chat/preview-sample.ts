import type { ChatMessage, ChatState, ToolBlock } from "@golem/view";

const NOTES_DIFF = [
  "diff --git a/Notes/Porto weekend.md b/Notes/Porto weekend.md",
  "new file mode 100644",
  "index 0000000..4c1d2aa",
  "--- /dev/null",
  "+++ b/Notes/Porto weekend.md",
  "@@ -0,0 +1,3 @@",
  "+## Saturday",
  "+- Ribeira and the Livraria Lello (book online)",
  "+## Sunday",
  "",
].join("\n");

const HELPER: NonNullable<ToolBlock["child"]> = {
  helpers: [],
  model: "qwen3.8:27b",
  modelCalls: 2,
  toolSteps: [],
  tokens: 4200,
  costUsd: 0,
  status: "done",
  answerTokens: 310,
  startedAt: null,
  durationMs: 9000,
};

function steps(failed: boolean): ToolBlock[] {
  return [
    { callId: "pv1", name: "web_search", args: { query: "Porto weekend itinerary" }, status: "done", summary: "12 results" },
    { callId: "pv2", name: "delegate", args: { agent: "explorer", brief: "Check opening hours" }, status: "done", preview: "Both are open on Sunday.", child: HELPER },
    { callId: "pv3", name: "read_file", args: { path: "~/Notes/Travel/Porto ideas.md" }, status: "done", summary: "1.2 KB" },
    failed
      ? { callId: "pv4", name: "run_shell", args: { command: "date +%A" }, status: "done", summary: "exit 1", unsuccessful: true, preview: "date: illegal option" }
      : { callId: "pv4", name: "run_shell", args: { command: "date +%A" }, status: "done", summary: "exit 0", preview: "Saturday" },
    { callId: "pv5", name: "write_file", args: { path: "~/Notes/Porto weekend.md" }, status: "done", summary: "new file +3 -0", diff: NOTES_DIFF },
  ];
}

/** One turn for the preview on Settings › Chat: a question, an answer after some thinking, five steps on a local model, one of them a helper. `failed` makes the command step fail. */
export function previewChat(failed: boolean): Pick<ChatState, "messages" | "error" | "notice"> {
  return {
    messages: [
      { id: "pq", role: "user", text: "Plan a weekend in Porto and save it to my notes", streaming: false, at: "2026-11-01T15:00:00" },
      {
        id: "pa",
        role: "assistant",
        text: "Here is a two-day plan: Saturday in Ribeira and the Livraria Lello, Sunday at Serralves and the beach at Foz. Saved as *Porto weekend.md*.",
        streaming: false,
        durationMs: 72_000,
        thinking: "Two days. Use their notes first, then check the day before saving.",
        thinkingMs: 3000,
        call: { model: "qwen3.8:27b", tier: "local", tokens: 34_200, costUsd: 0, done: true },
        tools: steps(failed),
      },
    ] satisfies ChatMessage[],
    error: null,
    notice: null,
  };
}
