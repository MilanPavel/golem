/** Five workers for the tests of the Changes view, shared by the web and the terminal. */

import type { ChatEvent } from "@golem/client";

let seq = 0;
function ev(type: string, data: Record<string, unknown>): ChatEvent {
  seq += 1;
  return { seq, session_id: "lead", run_id: "r1", ts: "2026-01-01T00:00:00Z", type, data } as unknown as ChatEvent;
}

const started = (index: number, label: string): ChatEvent =>
  ev("helper.started", { call_id: "d1", index, helper_id: `h${String(index)}`, agent: "coder", label, model: "local/qwen", wish: "same", pick_reason: "" });

const ended = (index: number, over: Record<string, unknown>): ChatEvent =>
  ev("helper.ended", { call_id: "d1", index, stopped: "done", model_calls: 9, tokens: 9000, answer_tokens: 300, cost_usd: 0, duration_ms: 60_000, working_ms: 58_000, ...over });

const file = (path: string, added: number, removed: number) => ({ path, status: "modified", added, removed });

/** httpx and aiohttp green, sqlmodel stopped at 25 calls with tests failing, pydantic failed checks, trio running. Helper ids are h0 to h4. */
export function workerFixture(): ChatEvent[] {
  return [
    started(0, "httpx"),
    started(1, "aiohttp"),
    started(2, "sqlmodel"),
    started(3, "pydantic"),
    started(4, "trio"),
    ended(0, { diff_artifact_id: "a0", files: [file("a.py", 30, 10), file("b.py", 8, 2)], added: 38, removed: 12, checks: "passed" }),
    ended(1, { diff_artifact_id: "a1", files: [file("c.py", 5, 1)], added: 5, removed: 1, checks: "passed" }),
    ended(2, { stopped: "calls", model_calls: 25, diff_artifact_id: "a2", files: [file("d.py", 20, 4)], added: 20, removed: 4, checks: "failed", checks_failed: ["tests"] }),
    ended(3, { diff_artifact_id: "a3", files: [file("e.py", 7, 7)], added: 7, removed: 7, checks: "failed", checks_failed: ["tests", "lint"] }),
  ];
}
