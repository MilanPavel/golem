import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_MESSAGE_BYTES, PAUSE_ABOVE_BYTES, createBridge } from "./core.ts";
import type { BridgeIO } from "./core.ts";

function setup() {
  const calls: string[] = [];
  const state = { buffered: 0, backlog: 0 };
  const io: BridgeIO = {
    toBrowser: (t) => calls.push(`browser:${t}`),
    browserBuffered: () => state.buffered,
    closeBrowser: (c, r) => calls.push(`closeBrowser:${c}:${r}`),
    toDaemon: (l) => calls.push(`daemon:${l}`),
    daemonBacklog: () => state.backlog,
    closeDaemon: () => calls.push("closeDaemon"),
    pauseDaemon: () => calls.push("pause"),
    resumeDaemon: () => calls.push("resume"),
  };
  return { calls, state, bridge: createBridge(io) };
}

const ping = (id: number) => `{"jsonrpc":"2.0","id":${id},"method":"ping"}`;
const enc = new TextEncoder();

test("an allowed message goes to the daemon once it is open", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserMessage(ping(1));
  assert.deepEqual(calls, [`daemon:${ping(1)}\n`]);
});

test("messages before the daemon opens are queued and flushed in order", () => {
  const { calls, bridge } = setup();
  bridge.browserMessage(ping(1));
  bridge.browserMessage(ping(2));
  assert.deepEqual(calls, []);
  bridge.daemonOpen();
  bridge.browserMessage(ping(3));
  assert.deepEqual(calls, [`daemon:${ping(1)}\n`, `daemon:${ping(2)}\n`, `daemon:${ping(3)}\n`]);
});

test("a denied request gets the reply and stays open", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserMessage('{"jsonrpc":"2.0","id":7,"method":"auth.set"}');
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? "", /^browser:.*"id":7.*-32020/);
});

test("a denied request with an object id gets nothing", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserMessage('{"id":{"a":1},"method":"auth.set"}');
  assert.deepEqual(calls, []);
});

test("two lines in one message close both sides and reach no one", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserMessage(`${ping(1)}\n${ping(2)}`);
  assert.deepEqual(calls, ["closeBrowser:1008:line-break", "closeDaemon"]);
  bridge.browserMessage(ping(3));
  assert.equal(calls.length, 2);
});

test("a binary message closes both sides", () => {
  const { calls, bridge } = setup();
  bridge.browserMessage(new Uint8Array([1, 2]));
  assert.deepEqual(calls, ["closeBrowser:1008:binary", "closeDaemon"]);
});

test("a queued message is dropped when the bridge closes before the daemon opens", () => {
  const { calls, bridge } = setup();
  bridge.browserMessage(ping(1));
  bridge.browserMessage("nope");
  bridge.daemonOpen();
  assert.deepEqual(calls, ["closeBrowser:1008:not-json", "closeDaemon"]);
});

test("daemon lines reach the browser, split across chunks, with UTF-8 kept whole", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  const bytes = enc.encode('{"t":"é"}\n{"t":"b"}\n');
  const cut = bytes.indexOf(0xc3) + 1;
  bridge.daemonData(bytes.slice(0, cut));
  assert.deepEqual(calls, []);
  bridge.daemonData(bytes.slice(cut));
  assert.deepEqual(calls, ['browser:{"t":"é"}', 'browser:{"t":"b"}']);
});

test("a slow browser pauses the daemon above 4 MiB and resumes only below it", () => {
  const { calls, state, bridge } = setup();
  bridge.daemonOpen();
  state.buffered = PAUSE_ABOVE_BYTES + 1;
  bridge.daemonData(enc.encode("a\n"));
  bridge.daemonData(enc.encode("b\n"));
  assert.deepEqual(calls, ["browser:a", "pause", "browser:b"]);
  bridge.browserDrain();
  assert.equal(calls.includes("resume"), false);
  state.buffered = PAUSE_ABOVE_BYTES;
  bridge.browserDrain();
  bridge.browserDrain();
  assert.deepEqual(calls.slice(3), ["resume"]);
});

test("drain without a pause does nothing", () => {
  const { calls, bridge } = setup();
  bridge.browserDrain();
  assert.deepEqual(calls, []);
});

test("a daemon that closes flushes its last partial line, then closes with 1001", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.daemonData(enc.encode("a\ntail"));
  bridge.daemonClosed();
  assert.deepEqual(calls, ["browser:a", "browser:tail", "closeBrowser:1001:daemon closed"]);
});

test("a daemon that cannot be reached closes with 1013", () => {
  const { calls, bridge } = setup();
  bridge.browserMessage(ping(1));
  bridge.daemonFailed();
  assert.deepEqual(calls, ["closeBrowser:1013:golem daemon is not running"]);
});

test("a browser close closes the daemon", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserClosed();
  assert.deepEqual(calls, ["closeDaemon"]);
});

test("after a close every event is a no-op and closes happen once", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserClosed();
  bridge.browserClosed();
  bridge.browserMessage(ping(1));
  bridge.browserMessage("nope");
  bridge.daemonData(enc.encode("a\n"));
  bridge.daemonClosed();
  bridge.daemonFailed();
  bridge.daemonOpen();
  bridge.browserDrain();
  assert.deepEqual(calls, ["closeDaemon"]);
});

test("after the daemon closes, later events are no-ops", () => {
  const { calls, bridge } = setup();
  bridge.daemonOpen();
  bridge.daemonClosed();
  bridge.daemonClosed();
  bridge.browserMessage(ping(1));
  bridge.browserClosed();
  assert.deepEqual(calls, ["closeBrowser:1001:daemon closed"]);
});

test("a queue over twice the message limit closes both sides", () => {
  const { calls, bridge } = setup();
  const big = `{"method":"ping","x":"${"a".repeat(MAX_MESSAGE_BYTES - 100)}"}`;
  bridge.browserMessage(big);
  bridge.browserMessage(big);
  assert.deepEqual(calls, []);
  bridge.browserMessage(big);
  assert.deepEqual(calls, ["closeBrowser:1008:too much unread input", "closeDaemon"]);
  bridge.daemonOpen();
  assert.equal(calls.length, 2);
});

test("a backlog above 4 MiB after a write closes both sides", () => {
  const { calls, state, bridge } = setup();
  bridge.daemonOpen();
  bridge.browserMessage(ping(1));
  state.backlog = 4 * 1024 * 1024 + 1;
  bridge.browserMessage(ping(2));
  assert.deepEqual(calls.slice(-2), ["closeBrowser:1008:too much unread input", "closeDaemon"]);
  bridge.browserMessage(ping(3));
  assert.equal(calls.filter((c) => c.startsWith("daemon:")).length, 2);
});
