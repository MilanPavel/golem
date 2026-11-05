import { pullSpeed, timeLeft } from "@golem/view";
import { expect, test, vi } from "vitest";
import { createPulls } from "./pulls.ts";
import { fakeClient } from "./test-support.ts";

const REF = "ollama/qwen3:8b";

function setup() {
  const fake = fakeClient();
  let at = 1_000_000;
  const pulls = createPulls(fake.client, () => at);
  pulls.start();
  return {
    fake,
    pulls,
    advance(ms: number) {
      at += ms;
    },
    progress(completed: number | null, total: number | null = 6_600_000_000, ref = REF) {
      fake.emitPull({
        kind: "progress",
        progress: { ref, status: "pulling", completed, total, progress: completed === null || total === null ? null : completed / total },
      });
    },
    done(ok: boolean, error: string | null = null, ref = REF) {
      fake.emitPull({ kind: "done", done: { ref, ok, error } });
    },
  };
}

test("progress, speed, and time left follow the clock", () => {
  const { pulls, progress, advance } = setup();
  progress(0);
  advance(5_000);
  progress(60_000_000);
  const entry = pulls.getSnapshot().active.get(REF);
  expect(entry?.status).toBe("pulling");
  expect(entry?.progress).toBeCloseTo(60 / 6600);
  expect(entry?.track.completed).toBe(60_000_000);
  expect(entry?.track.total).toBe(6_600_000_000);
  const speed = pullSpeed(entry!.track);
  expect(speed).toBe(12_000_000);
  expect(timeLeft((6_600_000_000 - 60_000_000) / speed!)).toBe("9 min");
});

test("no speed is told before there is a second to measure over", () => {
  const { pulls, progress, advance } = setup();
  progress(1_000_000_000);
  advance(200);
  progress(1_100_000_000);
  expect(pullSpeed(pulls.getSnapshot().active.get(REF)!.track)).toBeNull();
});

test("a download started elsewhere shows its progress", () => {
  const { pulls, progress } = setup();
  const listener = vi.fn();
  pulls.subscribe(listener);
  expect(pulls.getSnapshot().active.size).toBe(0);
  progress(1_000, 5_000);
  expect([...pulls.getSnapshot().active.keys()]).toEqual([REF]);
  expect(pulls.getSnapshot().active.get(REF)?.track.total).toBe(5_000);
  expect(listener).toHaveBeenCalledTimes(1);
});

test("a progress without bytes keeps what was known", () => {
  const { pulls, progress } = setup();
  progress(2_000, 5_000);
  progress(null, null);
  expect(pulls.getSnapshot().active.get(REF)?.track.completed).toBe(2_000);
});

test("done removes the download, and ok clears an old failure", () => {
  const { pulls, progress, done } = setup();
  progress(1);
  done(true);
  expect(pulls.getSnapshot().active.size).toBe(0);
  expect(pulls.getSnapshot().failed.size).toBe(0);
});

test("a failed download keeps its error until it starts again", () => {
  const { pulls, progress, done } = setup();
  progress(1);
  done(false, "disk full");
  expect(pulls.getSnapshot().active.size).toBe(0);
  expect(pulls.getSnapshot().failed.get(REF)).toBe("disk full");
  pulls.begin(REF);
  expect(pulls.getSnapshot().failed.size).toBe(0);
  expect(pulls.getSnapshot().active.get(REF)?.status).toBe("starting");
});

test("a failure without a message still says so", () => {
  const { pulls, done } = setup();
  done(false);
  expect(pulls.getSnapshot().failed.get(REF)).toBe("The download failed.");
});

test("a stop is not a failure", () => {
  const { pulls, progress, done } = setup();
  progress(1);
  done(false, "cancelled");
  expect(pulls.getSnapshot().failed.size).toBe(0);
  expect(pulls.getSnapshot().active.size).toBe(0);
});

test("the session switches once its download ends well", async () => {
  const { fake, pulls, progress, done } = setup();
  pulls.begin(REF);
  pulls.switchWhenDone(REF, "s1");
  progress(1);
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
  done(true);
  expect(fake.raw.setSessionModel).toHaveBeenCalledExactlyOnceWith("s1", REF);
});

test("the session does not switch when the download fails or is stopped", () => {
  const { fake, pulls, done } = setup();
  pulls.switchWhenDone(REF, "s1");
  done(false, "disk full");
  pulls.switchWhenDone(REF, "s1");
  done(false, "cancelled");
  pulls.switchWhenDone(REF, "s1");
  pulls.forget(REF);
  done(true);
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("a download nobody asked this page to switch for leaves the session alone", () => {
  const { fake, done } = setup();
  done(true);
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("a refused switch after the download does not throw", async () => {
  const { fake, pulls, done } = setup();
  fake.raw.setSessionModel.mockRejectedValueOnce(new Error("gone"));
  pulls.switchWhenDone(REF, "s1");
  done(true);
  await Promise.resolve();
  expect(fake.raw.setSessionModel).toHaveBeenCalledTimes(1);
});

test("abort takes a refused download off the list", () => {
  const { pulls } = setup();
  pulls.begin(REF);
  pulls.switchWhenDone(REF, "s1");
  pulls.abort(REF);
  expect(pulls.getSnapshot().active.size).toBe(0);
});

test("snapshots keep their reference when nothing changes", () => {
  const { pulls, progress, done } = setup();
  const before = pulls.getSnapshot();
  done(true);
  expect(pulls.getSnapshot()).toBe(before);
  pulls.abort(REF);
  expect(pulls.getSnapshot()).toBe(before);
  progress(1);
  const during = pulls.getSnapshot();
  expect(during).not.toBe(before);
  expect(pulls.getSnapshot()).toBe(during);
  pulls.begin(REF);
  expect(pulls.getSnapshot()).toBe(during);
});

test("a snapshot is never changed after it was handed out", () => {
  const { pulls, progress } = setup();
  progress(1);
  const first = pulls.getSnapshot();
  progress(2, 6_600_000_000, "ollama/other:1b");
  expect(first.active.size).toBe(1);
  expect(pulls.getSnapshot().active.size).toBe(2);
});

test("stop unsubscribes and clears", () => {
  const { fake, pulls, progress } = setup();
  progress(1);
  pulls.stop();
  expect(pulls.getSnapshot().active.size).toBe(0);
  progress(2);
  expect(pulls.getSnapshot().active.size).toBe(0);
  pulls.start();
  pulls.start();
  progress(3);
  expect(pulls.getSnapshot().active.size).toBe(1);
  expect(fake.client).toBeDefined();
});

test("after the link drops, the rows go back to the listing until progress comes again", () => {
  const { fake, pulls, progress, done } = setup();
  fake.setState({ status: "connected" });
  progress(1_000, 5_000);
  done(false, "disk full", "ollama/other:1b");
  fake.setState({ status: "reconnecting", attempt: 1, delayMs: 500 });
  expect(pulls.getSnapshot().active.size).toBe(1);
  fake.setState({ status: "connected" });
  expect(pulls.getSnapshot().active.size).toBe(0);
  expect(pulls.getSnapshot().failed.get("ollama/other:1b")).toBe("disk full");
  progress(2_000, 5_000);
  expect(pulls.getSnapshot().active.get(REF)?.track.completed).toBe(2_000);
});

test("defaultWhenDone sets the default when the download ends well, and not when it fails, stops, or is aborted", async () => {
  const { fake, pulls, done } = setup();
  pulls.defaultWhenDone(REF, "local");
  done(true);
  await Promise.resolve();
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("local");

  fake.raw.setDefaultModel.mockClear();
  pulls.defaultWhenDone(REF, "local");
  done(false, "no space");
  pulls.defaultWhenDone(REF, "local");
  done(false, "cancelled");
  pulls.defaultWhenDone(REF, "local");
  pulls.abort(REF);
  done(true);
  pulls.defaultWhenDone(REF, "local");
  pulls.forget(REF);
  done(true);
  await Promise.resolve();
  expect(fake.raw.setDefaultModel).not.toHaveBeenCalled();
});
