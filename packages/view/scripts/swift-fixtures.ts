/**
 * Writes `apps/apple/GolemKit/Tests/GolemKitTests/Fixtures/view-state.json`: what this package makes of
 * the golden logs, the Inbox and the Runs list, for GolemKit's own view state to be compared with
 * (`just swift-fixtures`, which `just golden` runs after it records the logs).
 *
 * For every golden log the file holds a snapshot after each event of `live`: the chat, its turns,
 * and the activity line and mark of every step. The Inbox and Runs cases are written by hand below.
 * Times are read in UTC, so the file does not depend on the machine that wrote it.
 */
process.env.TZ = "UTC";

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ChatEvent } from "@golem/client";

import { displayToolName, stepFailed, stepMark, summarizeSteps } from "../src/activity.ts";
import { answerTarget, approvalAnswerOptions, editedArgs, inboxAnswerOptions, parseArgs } from "../src/approval-args.ts";
import { emptyChat, reduceChat, type ChatMessage, type ChatState, type ToolBlock } from "../src/chat-state.ts";
import { golemState } from "../src/golem-state.ts";
import { inboxCount, inboxGroups, inboxItems, type InboxSession } from "../src/inbox.ts";
import {
  approvalsWords,
  needsYouCount,
  runBannerText,
  runDuration,
  runGroups,
  runName,
  runResultLine,
  runRowLine,
  runStartedText,
  runStepsWords,
  runTriggerWords,
  type RunLike,
} from "../src/runs.ts";
import { groupTurns, turnFooter } from "../src/turns.ts";

const GOLDEN = new URL("../fixtures/golden/", import.meta.url);
const OUT = new URL("../../../apps/apple/GolemKit/Tests/GolemKitTests/Fixtures/view-state.json", import.meta.url);

function tool(block: ToolBlock) {
  const answer = block.approval?.answer;
  return {
    callId: block.callId,
    name: block.name,
    displayName: displayToolName(block.name),
    status: block.status,
    mark: stepMark(block),
    failed: stepFailed(block),
    summary: block.summary ?? null,
    preview: block.preview ?? null,
    truncated: block.truncated === true,
    error: block.error ?? null,
    output: block.output ?? null,
    unsuccessful: block.unsuccessful === true,
    diff: block.diff ?? null,
    approvalSource: block.approval?.source ?? null,
    approvalSubject: block.approval?.subject ?? null,
    decision: answer?.decision ?? null,
    rule: answer?.rule ?? null,
    edited: answer?.edited ?? null,
  };
}

function message(item: ChatMessage) {
  return {
    id: item.id,
    role: item.role,
    text: item.text,
    streaming: item.streaming,
    interrupted: item.interrupted === true,
    at: item.at ?? null,
    runId: item.runId ?? null,
    durationMs: item.durationMs ?? null,
    thinking: item.thinking ?? null,
    thinkingMs: item.thinkingMs ?? null,
    skill: item.skill?.name ?? null,
    tools: (item.tools ?? []).map(tool),
  };
}

function snapshot(state: ChatState) {
  const turns = groupTurns(state.messages).map((turn) => {
    if (turn.kind === "user") return { kind: "user", id: turn.id, steps: [turn.message.id], activity: "", footer: null };
    const footer = turnFooter(turn.steps);
    return {
      kind: "golem",
      id: turn.id,
      steps: turn.steps.map((step) => step.id),
      activity: summarizeSteps(turn.steps.flatMap((step) => step.tools ?? [])),
      footer: footer === null ? null : { durationMs: footer.durationMs ?? null, tools: footer.tools },
    };
  });
  return {
    busy: state.busy,
    error: state.error,
    notice: state.notice,
    runId: state.runId,
    runStartedAt: state.runStartedAt,
    approval:
      state.approval === null
        ? null
        : { callId: state.approval.callId, name: state.approval.name, source: state.approval.source, diff: state.approval.diff },
    todos: state.todos,
    messages: state.messages.map(message),
    turns,
  };
}

const golden: Record<string, unknown> = {};
for (const name of readdirSync(GOLDEN).filter((file) => file.endsWith(".json")).sort()) {
  const fixture = JSON.parse(readFileSync(new URL(name, GOLDEN), "utf8")) as { live: ChatEvent[] };
  let state = emptyChat;
  const snapshots = fixture.live.map((event) => {
    state = reduceChat(state, event);
    return snapshot(state);
  });
  golden[name.replace(/\.json$/, "")] = { events: fixture.live.length, snapshots };
}

// The Inbox. `now` is 2026-11-14 10:00 UTC.
const NOW = Date.parse("2026-11-14T10:00:00Z");

const sessions: InboxSession[] = [
  {
    session_id: "lead",
    title: "Upgrade httpx",
    status: "waiting",
    pending: { kind: "approval", since: "2026-11-14T09:40:00Z", call_id: "c1", name: "edit_file", subject: "/repo/src/app.py", source: "built-in default", added: 4, removed: 2 },
    pending_items: [
      { kind: "approval", since: "2026-11-14T09:40:00Z", call_id: "c1", name: "edit_file", subject: "/repo/src/app.py", source: "built-in default", added: 4, removed: 2 },
      {
        kind: "approval",
        since: "2026-11-14T09:30:00Z",
        call_id: "c2",
        name: "shell",
        subject: "uv   run\n pytest",
        source: "built-in default",
        helper: { session_id: "h1", agent: "worker", label: "upgrade httpx", index: 1 },
        count: 3,
      },
      { kind: "consent", since: "2026-11-14T09:55:00Z", sent: ["the brief"], not_sent: ["this chat"], helper: { session_id: "h2", agent: "scout", label: " ", index: 2 } },
    ],
  },
  { session_id: "h1", title: "upgrade httpx", status: "waiting", parent_session_id: "lead", pending: { kind: "approval", since: "2026-11-14T09:30:00Z", call_id: "c2", name: "shell", subject: "uv run pytest", source: "x" } },
  { session_id: "plain", title: "  ", status: "waiting", pending: { kind: "approval", since: "2026-11-14T08:00:00.123456+00:00", call_id: "c3", name: "mcp__linear__create_issue", subject: "{}", source: "rule" } },
  { session_id: "writer", title: "Notes", status: "waiting", pending: { kind: "approval", since: "2026-11-13T07:00:00Z", call_id: "c4", name: "write_file", subject: "/repo/notes/", added: 12, source: "rule" } },
  { session_id: "long", title: "Long", status: "waiting", pending: { kind: "approval", since: "2026-11-14T09:59:30Z", call_id: "c5", name: "web_fetch", subject: "https://example.com/" + "a".repeat(100), source: "rule" } },
  { session_id: "tie-b", title: "B", status: "waiting", pending: { kind: "approval", since: "2026-11-14T09:50:00Z", call_id: "c6", name: "", source: "rule" } },
  { session_id: "tie-a", title: "A", status: "waiting", pending: { kind: "approval", since: "2026-11-14T09:50:00Z", call_id: "c7", name: "read_file", subject: "/a", source: "rule" } },
  { session_id: "bad-time", title: "Bad", status: "waiting", pending: { kind: "approval", since: "yesterday", call_id: "c8", name: "grep", subject: "x", source: "rule" } },
  { session_id: "shut", title: "Closed", status: "closed", pending: { kind: "approval", since: "2026-11-14T01:00:00Z", call_id: "c9", name: "shell", subject: "ls", source: "rule" } },
  { session_id: "quiet", title: "Idle", status: "idle" },
  { session_id: "orphan", title: "Orphan helper", status: "waiting", parent_session_id: "gone", pending: { kind: "approval", since: "2026-11-14T09:00:00Z", call_id: "c10", name: "shell", subject: "ls", source: "rule" } },
];

const inbox = {
  now: NOW,
  sessions,
  items: inboxItems(sessions, NOW).map((item) => ({
    sessionId: item.sessionId,
    sessionTitle: item.sessionTitle,
    kind: item.kind,
    callId: item.callId,
    headline: item.headline,
    source: item.source,
    since: item.since,
    age: item.age,
    added: item.added,
    removed: item.removed,
    helperName: item.helper?.name ?? null,
    helperSessionId: item.helper?.sessionId ?? null,
    count: item.count,
    answerSessionId: item.answerSessionId,
    sent: item.sent,
    notSent: item.notSent,
    options: inboxAnswerOptions(item, undefined).map((option) => option.id),
    target: answerTarget(item),
  })),
  groups: inboxGroups(sessions, NOW).map((group) => ({ sessionId: group.sessionId, waiting: group.waiting, callIds: group.items.map((item) => item.callId) })),
  count: inboxCount(inboxItems(sessions, NOW)),
};

// The Runs list.
const runs: RunLike[] = [
  { session_id: "r-wait", kind: "routine", routine: "sentry-triage", trigger: "schedule", status: "waiting", started_at: "2026-11-14T09:56:00Z", summary: "Allow mcp__linear__create_issue\nmore", approvals: 1 },
  { session_id: "r-appr", kind: "routine", routine: "pr-digest", trigger: "manual", status: "running", started_at: "2026-11-14T09:48:00Z", approvals: 2 },
  { session_id: "r-run", kind: "routine", routine: "receipts", trigger: "watch", status: "running", started_at: "2026-11-14T09:59:48Z", watch_path: "/home/me/Inbox/Uber_0311.pdf" },
  { session_id: "r-queue", kind: "routine", routine: "later", trigger: "hook", status: "queued", started_at: null },
  { session_id: "r-done", kind: "routine", routine: "morning-brief", trigger: "schedule", status: "succeeded", started_at: "2026-11-14T08:30:00Z", ended_at: "2026-11-14T08:31:04Z", summary: "6 PRs, 2 failing builds\nrest" },
  { session_id: "r-done2", kind: "routine", routine: "receipts", trigger: "watch", status: "succeeded", started_at: "2026-11-14T07:55:00Z", ended_at: "2026-11-14T07:55:30Z", watch_path: "/x/y/", summary: "Added a row: Lidl, 23.40" },
  { session_id: "r-fail", kind: "routine", routine: "digest", trigger: "schedule", status: "failed", started_at: "2026-11-14T06:00:00Z", ended_at: "2026-11-14T06:00:09Z", reason: "the model did not answer" },
  { session_id: "r-skip", kind: "routine", routine: "digest", trigger: "schedule", status: "skipped", started_at: "2026-11-14T05:00:00Z", reason: "paused" },
  { session_id: "r-stop", kind: "routine", routine: "digest", trigger: "schedule", status: "cancelled", started_at: "2026-11-14T04:00:00Z", ended_at: "2026-11-14T03:00:00Z" },
  { session_id: "r-yday", kind: "routine", routine: "morning-brief", trigger: "schedule", status: "succeeded", started_at: "2026-11-13T08:30:00Z", ended_at: "2026-11-13T08:31:00Z" },
  { session_id: "r-old", kind: "routine", routine: "morning-brief", trigger: "schedule", status: "failed", started_at: "2026-11-10T08:30:00Z", ended_at: "2026-11-10T08:30:01Z" },
  { session_id: "r-ask", kind: "ask", status: "succeeded", started_at: "2026-11-14T09:00:00Z", ended_at: "2026-11-14T09:00:05Z", summary: "done" },
  { session_id: "r-wf", kind: "workflow", routine: "pr-digest", status: "running", started_at: "2026-11-14T09:00:00Z", steps: 4 },
  { session_id: "r-wf1", kind: "workflow", status: "succeeded", started_at: "2026-11-14T09:30:00Z", ended_at: "2026-11-14T09:30:30Z", steps: 1 },
  { session_id: "r-bad", kind: "routine", routine: "odd", status: "succeeded", started_at: "not a date" },
  { session_id: "r-future", kind: "routine", routine: "soon", trigger: "schedule", status: "succeeded", started_at: "2026-11-14T12:00:00Z", ended_at: "2026-11-14T12:00:10Z" },
];

const runsCase = {
  now: NOW,
  runs,
  groups: runGroups(runs, NOW).map((group) => ({ label: group.label, ids: group.items.map((run) => run.session_id) })),
  needsYou: needsYouCount(runs),
  rows: runs.map((run) => ({
    id: run.session_id,
    name: runName(run),
    trigger: runTriggerWords(run),
    started: runStartedText(run, NOW),
    steps: runStepsWords(run),
    line: runRowLine(run, NOW),
    duration: runDuration(run, NOW),
    result: runResultLine(run),
    banner: runBannerText(run, NOW),
    approvals: approvalsWords(run.approvals ?? 0),
  })),
};

// Small pure helpers.
const args = [
  `{"path": "a.txt"}`,
  `[1]`,
  `nope`,
  `"text"`,
  `null`,
  `{}`,
];
const approvals = {
  parse: args.map((text) => {
    const parsed = parseArgs(text);
    return parsed.ok ? { ok: true, keys: Object.keys(parsed.args).sort() } : { ok: false };
  }),
  edited: [
    editedArgs({ a: 1, b: 2 }, { a: 1, b: 2 }) === null,
    editedArgs({ a: 1, b: 2 }, { a: 1, b: 3 }) === null,
  ],
  options: [
    approvalAnswerOptions({ helper: false }),
    approvalAnswerOptions({ helper: true }),
    approvalAnswerOptions({ helper: true, count: 3 }),
    approvalAnswerOptions({ helper: true, siblings: 2 }),
  ].map((list) => list.map((option) => ({ id: option.id, key: option.key, label: option.label, decision: option.decision, scope: option.scope ?? null }))),
};

const states = (["connected", "connecting", "reconnecting", "stopped"] as const).flatMap((connection) =>
  ([null, "thinking", "writing", "waiting"] as const).flatMap((phase) =>
    [false, true].map((error) => ({ connection, phase, error, state: golemState({ connection: connection as never, phase, error }) })),
  ),
);

mkdirSync(dirname(OUT.pathname), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ golden, inbox, runs: runsCase, approvals, golemStates: states }, null, 2)}\n`);
process.stdout.write(`wrote ${OUT.pathname}\n`);
