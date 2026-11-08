import type { TraceMessage, TraceModelSpan, TraceRunSpan, TraceSpanResult, TraceToolSpan } from "../../store/trace.ts";

const BASE = Date.parse("2026-11-07T10:00:00.000Z");
const at = (ms: number): string => new Date(BASE + ms).toISOString();

type ToolOptions = Partial<Pick<TraceToolSpan, "status" | "approval_wait_ms" | "preview">>;

export function sampleTool(id: string, name: string, start: number, duration: number, options: ToolOptions = {}): TraceToolSpan {
  return {
    id,
    kind: "tool",
    name,
    start: at(start),
    end: at(start + duration + (options.approval_wait_ms ?? 0)),
    duration_ms: duration,
    status: "ok",
    preview: "",
    recorded: true,
    ...options,
  };
}

type ModelOptions = { tokens?: [number, number]; recorded?: boolean; status?: TraceModelSpan["status"] };

export function sampleModel(
  id: string,
  number: number,
  start: number,
  latency: number,
  children: TraceToolSpan[] = [],
  options: ModelOptions = {},
): TraceModelSpan {
  const recorded = options.recorded ?? true;
  return {
    id,
    kind: "model",
    name: `model ${number}`,
    start: at(start),
    end: at(start + latency),
    duration_ms: latency,
    status: options.status ?? "ok",
    model: recorded ? "ollama/qwen3-coder:30b" : null,
    tokens: recorded && options.tokens ? { input: options.tokens[0], output: options.tokens[1], cache_read: null, cache_write: null } : null,
    first_token_ms: recorded ? 120 : null,
    preview: "",
    recorded,
    children,
  };
}

export function sampleRun(id: string, name: string, start: number, duration: number, children: TraceModelSpan[], status: TraceRunSpan["status"] = "ok"): TraceRunSpan {
  return { id, kind: "run", name, start: at(start), end: at(start + duration), duration_ms: duration, status, preview: "", recorded: true, children };
}

/** One run: two model calls, and the two tools the first asked for. */
export const SHORT_TRACE: TraceRunSpan[] = [
  sampleRun("r_1", "What is in notes.txt?", 0, 4200, [
    sampleModel("m_1", 1, 0, 2100, [sampleTool("c_1", "grep", 2100, 48), sampleTool("c_2", "read_file", 2160, 12)], { tokens: [3200, 90] }),
    sampleModel("m_2", 2, 2300, 1900, [], { tokens: [3400, 210] }),
  ]),
];

/** One run with 25 model calls, each asking for one tool, then a short run after it. */
export const LONG_TRACE: TraceRunSpan[] = [
  sampleRun(
    "r_1",
    "Read every file in the folder",
    0,
    25 * 900,
    Array.from({ length: 25 }, (_, i) =>
      sampleModel(`m_${i + 1}`, i + 1, i * 900, 600, [sampleTool(`c_${i + 1}`, "read_file", i * 900 + 600, 120)], { tokens: [1000 + i * 100, 80] }),
    ),
  ),
  sampleRun("r_2", "Thanks", 25 * 900 + 1000, 1500, [sampleModel("m_26", 26, 25 * 900 + 1000, 1500, [], { tokens: [3900, 20] })]),
];

/** A tool that ran and failed, and one the model asked for and the user denied. */
export const FAILED_TRACE: TraceRunSpan[] = [
  sampleRun("r_1", "Run the tests", 0, 5200, [
    sampleModel("m_1", 1, 0, 1200, [
      sampleTool("c_1", "shell", 1200, 3100, { status: "failed", preview: "exit 1" }),
      sampleTool("c_2", "write_file", 1250, 0, { status: "denied", preview: "denied" }),
    ], { tokens: [2100, 140] }),
    sampleModel("m_2", 2, 4400, 800, [], { tokens: [2600, 60] }),
  ], "ok"),
];

/** A tool that waited 12 s for the user before it ran 30 ms. */
export const APPROVAL_TRACE: TraceRunSpan[] = [
  sampleRun("r_1", "Fix the typo", 0, 15000, [
    sampleModel("m_1", 1, 0, 1500, [sampleTool("c_1", "edit_file", 1500, 30, { approval_wait_ms: 12000 })], { tokens: [1800, 220] }),
    sampleModel("m_2", 2, 13600, 1200, [], { tokens: [2100, 40] }),
  ]),
];

/** A session from before traces: no model, tokens, or first token. */
export const OLD_TRACE: TraceRunSpan[] = [
  sampleRun("r_1", "Explain this error", 0, 3000, [
    sampleModel("m_1", 1, 0, 1000, [sampleTool("c_1", "read_file", 1000, 20)], { recorded: false }),
    sampleModel("m_2", 2, 1100, 1900, [], { recorded: false }),
  ]),
];

const USER: TraceMessage = { id: "u_1", role: "user", text: "What is in **notes.txt**?" };
const ASKED: TraceMessage = {
  id: "m_1",
  role: "assistant",
  text: "Let me look.",
  tool_calls: [{ call_id: "c_1", name: "read_file", args: { path: "notes.txt" } }],
};
const SEEN: TraceMessage = { id: "t_1", role: "tool", text: Array.from({ length: 30 }, (_, i) => `line ${i + 1}: the answer is 42`).join("\n"), call_id: "c_1" };

/** The second model call: the system prompt and two tools, three messages, and the last two are new. */
export const MODEL_DETAIL: TraceSpanResult = {
  span: SHORT_TRACE[0]?.children?.[1] as TraceModelSpan,
  system_prompt: "You are golem, a coding agent. Work in the folder you are given.",
  tools: [
    { type: "function", function: { name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "grep", description: "Search files.", parameters: { type: "object", properties: { pattern: { type: "string" } } } } },
  ],
  messages: [USER, ASKED, SEEN],
  new_from: 1,
  reply: { id: "m_2", role: "assistant", text: "It says **42**.", tool_calls: [] },
  stop_reason: "end_turn",
  provider: "ollama",
};

/** A tool whose output was too big for the model: the start went back, and the rest is in an artifact. */
export const TOOL_DETAIL: TraceSpanResult = {
  span: SHORT_TRACE[0]?.children?.[0]?.children?.[1] as TraceToolSpan,
  args: { path: "notes.txt", offset: 0 },
  result: "head of the output\n… the whole output is saved as artifact a_9f3c",
  artifact_id: "a_9f3c",
};

/** A tool call the user allowed after editing its arguments. */
export const APPROVAL_DETAIL: TraceSpanResult = {
  span: APPROVAL_TRACE[0]?.children?.[0]?.children?.[0] as TraceToolSpan,
  args: { path: "notes.txt", old_string: "world", new_string: "there" },
  result: "Edited notes.txt",
  approval: { call_id: "c_1", name: "edit_file", decision: "allow", rule: "built-in default", args: { path: "notes.txt", old_string: "world", new_string: "edited" } },
};

/** A model call from before traces: no system prompt or tools, and the messages before its reply. */
export const OLD_DETAIL: TraceSpanResult = {
  span: OLD_TRACE[0]?.children?.[0] as TraceModelSpan,
  messages: [USER],
  new_from: 0,
  reply: { id: "m_1", role: "assistant", text: "It is an off-by-one.", tool_calls: [] },
};
