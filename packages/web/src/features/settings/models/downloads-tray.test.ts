import { expect, test } from "vitest";
import type { PullEntry, PullsSnapshot } from "../../../store/pulls.ts";
import { dismissFailed, dismissReady, EMPTY_TRAY, stopTray, trayName, trayRows, trayStatus, trayText, watchTray } from "./downloads-tray.ts";

const REF = "ollama/gemma4:12b";
const HF = "ollama/hf.co/unsloth/Qwen3.8-27B-Instruct-GGUF:Q4_K_M";
const NONE = new Set<string>();

function entry(completed: number, total: number | null): PullEntry {
  return { track: { completed, total, samples: [] }, status: "pulling", progress: null };
}

function snapshot(active: [string, PullEntry][] = [], failed: [string, string][] = []): PullsSnapshot {
  return { active: new Map(active), failed: new Map(failed) };
}

test("a download that leaves the running ones nearly done is ready", () => {
  const running = watchTray(EMPTY_TRAY, snapshot([[REF, entry(7.9e9, 8e9)]]), NONE);
  expect(running.ready).toEqual([]);
  const after = watchTray(running, snapshot(), NONE);
  expect(after.ready).toEqual([REF]);
  // Nothing changes: the same memory comes back.
  expect(watchTray(after, snapshot(), NONE)).toBe(after);
});

test("a stop, a lost link or a failure is not ready", () => {
  const running = watchTray(EMPTY_TRAY, snapshot([[REF, entry(2e9, 8e9)]]), NONE);
  expect(watchTray(running, snapshot(), NONE).ready).toEqual([]);
  expect(watchTray(running, snapshot(), NONE).ready).toEqual([]);
  expect(watchTray(running, snapshot([], [[REF, "no space left"]]), NONE).ready).toEqual([]);
});

test("a download that was not nearly done is ready when the listing has the model", () => {
  const running = watchTray(EMPTY_TRAY, snapshot([[REF, entry(2e9, 8e9)]]), NONE);
  expect(watchTray(running, snapshot(), new Set([REF])).ready).toEqual([REF]);
});

test("a ready download goes when it starts again, and when it is dismissed", () => {
  const ready = watchTray(watchTray(EMPTY_TRAY, snapshot([[REF, entry(8e9, 8e9)]]), NONE), snapshot(), NONE);
  expect(dismissReady(ready, REF).ready).toEqual([]);
  expect(watchTray(ready, snapshot([[REF, entry(0, null)]]), NONE).ready).toEqual([]);
});

test("a dismissed failure stays hidden until it fails with other words", () => {
  const failed = snapshot([], [[REF, "no space left"]]);
  const memory = dismissFailed(EMPTY_TRAY, REF, "no space left");
  expect(trayRows(memory, failed)).toEqual([]);
  expect(trayRows(memory, snapshot([], [[REF, "the network dropped"]]))).toHaveLength(1);
  // Starting again forgets the dismissal.
  expect(watchTray(memory, snapshot(), NONE).dismissed.size).toBe(0);
});

test("the rows run first, then ready, then failed, and a stop is not a failure", () => {
  const memory = { ...EMPTY_TRAY, ready: [HF] };
  const rows = trayRows(memory, snapshot([[REF, entry(2.6e9, 8.1e9)]], [["ollama/a:1b", "boom"], ["ollama/b:1b", "cancelled"]]));
  expect(rows.map((row) => `${row.kind} ${row.name}`)).toEqual(["running gemma4:12b", "ready unsloth/Qwen3.8-27B-Instruct-GGUF:Q4_K_M", "failed a:1b"]);
});

test("the words of a running download", () => {
  expect(trayText(entry(5.5e9, 16.2e9))).toBe("33% · 5.5 of 16.2 GB");
  expect(trayText(entry(0, null))).toBe("starting…");
  expect(trayText({ track: { completed: 5.5e9, total: 16.2e9, samples: [{ at: 0, bytes: 0 }, { at: 5_000, bytes: 5.5e9 }] }, status: "pulling", progress: null })).toMatch(/^33% · 5\.5 of 16\.2 GB · .+ left$/);
  expect(trayName(HF)).toBe("unsloth/Qwen3.8-27B-Instruct-GGUF:Q4_K_M");
});

test("the status region names downloads, never a percent", () => {
  const memory = { ...EMPTY_TRAY, ready: [HF] };
  const text = trayStatus(trayRows(memory, snapshot([[REF, entry(1e9, 8e9)]], [["ollama/a:1b", "boom"]])));
  expect(text).toBe("Downloading gemma4:12b. unsloth/Qwen3.8-27B-Instruct-GGUF:Q4_K_M is ready. Download of a:1b failed: boom");
  expect(text).not.toContain("%");
});

test("a stop is not ready, and the same download started again and finished is", () => {
  const running = watchTray(EMPTY_TRAY, snapshot([[REF, entry(7.9e9, 8e9)]]), NONE);
  const stopping = stopTray(running, REF);
  // The stop has not taken effect yet: it is remembered.
  expect(watchTray(stopping, snapshot([[REF, entry(7.9e9, 8e9)]]), NONE).stopped.has(REF)).toBe(true);
  const stopped = watchTray(stopping, snapshot(), NONE);
  expect(stopped.ready).toEqual([]);
  expect(stopped.stopped.size).toBe(0);
  const again = watchTray(stopped, snapshot([[REF, entry(7.9e9, 8e9)]]), NONE);
  expect(watchTray(again, snapshot(), NONE).ready).toEqual([REF]);
});
