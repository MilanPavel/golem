import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { type AskArgs, type AskClient, EXIT_APPROVAL, parseAskArgs, parseOpenArgs, runAsk, sessionPath } from "./ask.ts";
import { webLink } from "./web.ts";

type Listener = (event: ChatEvent) => void;

/** A daemon that answers a `message.send` with the given events, in order. */
function fakeClient(events: Array<{ type: string; data: Record<string, unknown> }>) {
  const calls: { created: unknown[]; sent: Array<{ text: string; options: unknown }>; attached: string[] } = {
    created: [],
    sent: [],
    attached: [],
  };
  let listener: Listener | null = null;
  const client: AskClient = {
    createSession: (options) => {
      calls.created.push(options);
      return Promise.resolve({ session_id: "s1" });
    },
    attachSession: (id) => {
      calls.attached.push(id);
      return Promise.resolve({});
    },
    onEvent: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    sendMessage: (_id, text, options) => {
      calls.sent.push({ text, options });
      setTimeout(() => {
        let seq = 1;
        for (const e of events) {
          listener?.({ seq: seq++, session_id: "s1", run_id: "r1", ts: "t", ...e } as unknown as ChatEvent);
        }
      }, 0);
      return Promise.resolve({});
    },
  };
  return { client, calls };
}

function io() {
  const seen = { out: "", err: "" };
  return { seen, io: { out: (t: string) => (seen.out += t), err: (t: string) => (seen.err += t) } };
}

const base: AskArgs = { prompt: "list my open PRs", detach: false, folder: "/tmp/g" };

test("ask waits and prints the answer, exit 0", async () => {
  const { client, calls } = fakeClient([
    { type: "message.completed", data: { role: "assistant", text: "You have 2 PRs.", message_id: "m" } },
    { type: "session.completed", data: { run_id: "r1", status: "completed", summary: "cut" } },
  ]);
  const { seen, io: out } = io();
  assert.equal(await runAsk(client, base, out), 0);
  assert.equal(seen.out, "You have 2 PRs.\n");
  assert.deepEqual(calls.created, [{ cwd: "/tmp/g", origin: "cli" }]);
  assert.deepEqual(calls.attached, ["s1"]);
  assert.equal(calls.sent[0]?.text, "list my open PRs");
});

test("ask --detach prints the session id and returns without waiting", async () => {
  const { client, calls } = fakeClient([]);
  const { seen, io: out } = io();
  assert.equal(await runAsk(client, { ...base, detach: true, model: "fast" }, out), 0);
  assert.equal(seen.out, "s1\n");
  assert.deepEqual(calls.created, [{ cwd: "/tmp/g", origin: "cli", modelProfile: "fast" }]);
  assert.deepEqual(calls.attached, []);
  assert.equal(calls.sent.length, 1);
});

test("ask exits 3 and says how to answer when the run stops on an approval", async () => {
  const { client } = fakeClient([
    { type: "approval.needed", data: { call_id: "c", name: "bash", args: {}, source: "built-in default", subject: "git push" } },
  ]);
  const { seen, io: out } = io();
  assert.equal(await runAsk(client, base, out), EXIT_APPROVAL);
  assert.equal(seen.out, "");
  assert.match(seen.err, /bash: git push/);
  assert.match(seen.err, /golem open s1/);
});

test("ask exits 1 with the reason when the run fails", async () => {
  const { client } = fakeClient([
    { type: "run.failed", data: { message: "model unreachable" } },
    { type: "session.completed", data: { run_id: "r1", status: "failed", summary: null } },
  ]);
  const { seen, io: out } = io();
  assert.equal(await runAsk(client, base, out), 1);
  assert.match(seen.err, /model unreachable/);
});

test("ask --skill sends the skill call", async () => {
  const { client, calls } = fakeClient([{ type: "session.completed", data: { run_id: "r1", status: "completed", summary: "ok" } }]);
  const { seen, io: out } = io();
  assert.equal(await runAsk(client, { ...base, skill: "ship" }, out), 0);
  assert.equal(seen.out, "ok\n");
  assert.deepEqual(calls.sent[0], { text: "/ship list my open PRs", options: { skill: { name: "ship", args: "list my open PRs" } } });
});

test("parseAskArgs: prompt and options", () => {
  assert.deepEqual(parseAskArgs(["hi", "--detach", "--model", "m", "--skill", "s", "--folder", "/x"]), {
    kind: "ask",
    args: { prompt: "hi", detach: true, model: "m", skill: "s", folder: "/x" },
  });
  assert.deepEqual(parseAskArgs(["--detach", "hi"]), { kind: "ask", args: { prompt: "hi", detach: true } });
  for (const bad of [[], [""], ["a", "b"], ["hi", "--model"], ["hi", "--model", "--detach"], ["hi", "--bogus"], ["hi", "--detach", "--detach"], ["hi", "--model", "a", "--model", "b"]]) {
    assert.equal(parseAskArgs(bad).kind, "error", bad.join(" "));
  }
});

test("parseOpenArgs: an id, and --web", () => {
  assert.deepEqual(parseOpenArgs(["abc"]), { sessionId: "abc", web: false, notified: false });
  assert.deepEqual(parseOpenArgs(["abc", "--web"]), { sessionId: "abc", web: true, notified: false });
  assert.deepEqual(parseOpenArgs(["--web", "abc"]), { sessionId: "abc", web: true, notified: false });
  assert.deepEqual(parseOpenArgs(["abc", "--notified"]), { sessionId: "abc", web: false, notified: true });
  for (const bad of [[], ["--web"], ["a", "b"], ["a", "--json"], ["a", "--web", "--web"], ["a", "--web", "--notified"]]) {
    assert.equal(parseOpenArgs(bad), null, bad.join(" "));
  }
});

test("open --web builds the gateway address of the session", () => {
  assert.equal(sessionPath("abc"), "/s/abc");
  assert.equal(webLink(7480, "tok", sessionPath("abc")), "http://127.0.0.1:7480/s/abc#t=tok");
  assert.equal(webLink(7480, "tok"), "http://127.0.0.1:7480/#t=tok");
});
