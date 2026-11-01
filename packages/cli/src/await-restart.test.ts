import assert from "node:assert/strict";
import { test } from "node:test";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import { awaitRestart, formatRestarted } from "./await-restart.ts";

function status(pid: number, state: DaemonStatus["state"] = "running"): DaemonStatus {
  return { pid, version: "0.2.0", protocol_major: 2, protocol_minor: 18, uptime_seconds: 0, state };
}

function clock(answers: (DaemonStatus | null)[]) {
  let time = 0;
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    wait: {
      readStatus: async () => answers[Math.min(calls++, answers.length - 1)] ?? null,
      sleep: async (ms: number) => {
        time += ms;
      },
      now: () => time,
      timeoutMs: 1_000,
      pollMs: 100,
    },
  };
}

test("the old daemon, still draining or not, does not count as restarted", async () => {
  const fake = clock([status(7), status(7, "draining"), null, status(9, "draining"), status(9)]);
  assert.deepEqual(await awaitRestart(7, fake.wait), status(9));
  assert.equal(fake.calls, 5);
});

test("a daemon that was not running counts as soon as one answers", async () => {
  const fake = clock([null, status(3)]);
  assert.deepEqual(await awaitRestart(null, fake.wait), status(3));
});

test("waiting stops at once when giving up says so", async () => {
  const fake = clock([null]);
  assert.equal(await awaitRestart(null, { ...fake.wait, giveUp: () => fake.calls >= 2 }), null);
  assert.equal(fake.calls, 2);
});

test("a daemon that never comes back times out", async () => {
  const fake = clock([null]);
  assert.equal(await awaitRestart(7, fake.wait), null);
  assert.equal(fake.calls, 11);
});

test("the report names the new version, or where to look", () => {
  assert.equal(formatRestarted(status(9), 10_000), "daemon 0.2.0 is running (pid 9)");
  assert.match(formatRestarted(null, 10_000), /did not come back within 10 s; see golem daemon logs/);
});
