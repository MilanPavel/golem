import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, SESSION_NOT_FOUND, type SessionSummary } from "@golem/client";

import { openLatest, openNew, openOne, type SessionOpener } from "./session-open.ts";

function summary(sessionId: string): SessionSummary {
  return {
    session_id: sessionId,
    model_profile: "remote",
    title: null,
    status: "idle",
    created_at: "2026-10-14T10:00:00+00:00",
    updated_at: "2026-10-14T10:00:00+00:00",
    last_seq: 3,
  };
}

function fake(sessions: SessionSummary[], missing: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const client: SessionOpener = {
    listSessions: (limit) => {
      calls.push(`list ${limit}`);
      return Promise.resolve({ sessions: sessions.slice(0, limit) });
    },
    createSession: () => {
      calls.push("create");
      return Promise.resolve({ session_id: "s_new" });
    },
    attachSession: (sessionId) => {
      calls.push(`attach ${sessionId}`);
      if (missing.has(sessionId)) {
        return Promise.reject(new RpcError(SESSION_NOT_FOUND, "session not found"));
      }
      return Promise.resolve({ session_id: sessionId, last_seq: 3 });
    },
  };
  return { client, calls };
}

test("openLatest attaches to the newest session", async () => {
  const { client, calls } = fake([summary("s_newest"), summary("s_older")]);
  const chosen: string[] = [];
  assert.equal(await openLatest(client, (id) => chosen.push(id)), "s_newest");
  assert.deepEqual(calls, ["list 1", "attach s_newest"]);
  assert.deepEqual(chosen, ["s_newest"]);
});

test("openLatest starts a session when there is none", async () => {
  const { client, calls } = fake([]);
  assert.equal(await openLatest(client, () => undefined), "s_new");
  assert.deepEqual(calls, ["list 1", "create", "attach s_new"]);
});

test("openLatest replaces a session that vanished", async () => {
  const { client, calls } = fake([summary("s_gone")], new Set(["s_gone"]));
  const chosen: string[] = [];
  assert.equal(await openLatest(client, (id) => chosen.push(id)), "s_new");
  assert.deepEqual(calls, ["list 1", "attach s_gone", "create", "attach s_new"]);
  assert.deepEqual(chosen, ["s_gone", "s_new"]);
});

test("openNew chooses the session before the replay arrives", async () => {
  const { client, calls } = fake([]);
  const order: string[] = [];
  const chooseFirst: SessionOpener = {
    ...client,
    attachSession: (sessionId, afterSeq) => {
      order.push("attach");
      return client.attachSession(sessionId, afterSeq);
    },
  };
  await openNew(chooseFirst, () => order.push("choose"));
  assert.deepEqual(order, ["choose", "attach"]);
  assert.deepEqual(calls, ["create", "attach s_new"]);
});

test("openOne chooses the session before attaching to it", async () => {
  const { client, calls } = fake([]);
  const opened = await openOne(client, "s_b", (sessionId) => {
    calls.push(`choose ${sessionId}`);
  });
  assert.equal(opened, "s_b");
  assert.deepEqual(calls, ["choose s_b", "attach s_b"]);
});
