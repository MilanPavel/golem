import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { Attachments, type ChatEvent } from "@golem/client";

import { emptyChat, reduceChat, type ChatState } from "./chat-state.ts";

/**
 * Event logs recorded from a real daemon with a fake model, by
 * `packages/daemon/tests/golden.py` (`just golden`). `live` is what a client
 * attached from 0 received while the run went on; `replay` is what a second
 * client got by attaching from `after_seq: 0` after it ended.
 *
 * The TUI and the browser both fold events with `reduceChat`, so one chat from
 * every path proves they draw the same thing. `ChatState` holds times, but they
 * come from the events' own `ts`, which the recorder fixes, so nothing is excluded.
 */
const FOLDER = new URL("../fixtures/golden/", import.meta.url);

type Fixture = { live: ChatEvent[]; replay: ChatEvent[] };

function fold(events: readonly ChatEvent[]): ChatState {
  return events.reduce(reduceChat, emptyChat);
}

/** The events a client keeps after a reconnect: a prefix, then the stream again from an earlier `seq`. */
function reconnected(live: readonly ChatEvent[]): ChatEvent[] {
  // Renumber with gaps, so nothing may rely on `seq` counting up by one.
  const spread = live.map((event) => ({ ...event, seq: event.seq * 3 }));
  const cut = Math.ceil(spread.length * 0.6);
  const again = Math.floor(cut / 2);
  const delivered = [...spread.slice(0, cut), ...spread.slice(again)];
  const attachments = new Attachments();
  const sessionId = spread[0]?.session_id ?? "";
  attachments.track(sessionId, 0);
  return delivered.filter((event) => attachments.accept(event));
}

const names = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".json"))
  .sort();

test("the fixtures cover the five scenarios", () => {
  assert.deepEqual(
    names.map((name) => name.replace(/\.json$/, "")),
    ["approval", "cancel", "failure", "plain", "tool"],
  );
});

for (const name of names) {
  const fixture = JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as Fixture;

  test(`${name}: live, replayed, and reconnected events give the same chat`, () => {
    const live = fold(fixture.live);
    assert.ok(fixture.live.length > 0 && fixture.replay.length > 0);
    assert.deepEqual(fold(fixture.replay), live, "replay from 0 differs from live");
    const delivered = reconnected(fixture.live);
    assert.equal(delivered.length, fixture.live.length, "the client dropped every repeat and nothing else");
    assert.deepEqual(fold(delivered), live, "reconnect with repeats and gaps differs from live");
  });

  test(`${name}: the run ended and the chat is idle`, () => {
    const state = fold(fixture.live);
    assert.equal(state.busy, false);
    assert.equal(state.approval, null);
  });
}
