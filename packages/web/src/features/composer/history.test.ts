import { expect, test } from "vitest";
import { createHistory, HISTORY_KEY, HISTORY_LIMIT, recall, type HistoryStorage } from "./history.ts";

function fakeStorage(initial?: string): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[HISTORY_KEY, initial]]);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test("texts are saved newest last, and a repeat of the last one is kept once", () => {
  const storage = fakeStorage();
  const history = createHistory(() => storage);
  history.add("one");
  history.add("two");
  history.add("two");
  history.add("   ");
  history.add("one");
  expect(history.entries()).toEqual(["one", "two", "one"]);
  expect(JSON.parse(storage.data.get(HISTORY_KEY) ?? "null")).toEqual(["one", "two", "one"]);
  expect(createHistory(() => storage).entries()).toEqual(["one", "two", "one"]);
});

test("only the last 100 are kept", () => {
  const storage = fakeStorage();
  const history = createHistory(() => storage);
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    history.add(`text ${i}`);
  }
  const entries = history.entries();
  expect(entries).toHaveLength(HISTORY_LIMIT);
  expect(entries[0]).toBe("text 5");
  expect(entries[HISTORY_LIMIT - 1]).toBe(`text ${HISTORY_LIMIT + 4}`);
});

test("it works without storage, and with storage that throws or holds junk", () => {
  const none = createHistory(() => null);
  none.add("a");
  expect(none.entries()).toEqual(["a"]);
  const broken = createHistory(() => {
    throw new Error("denied");
  });
  broken.add("b");
  expect(broken.entries()).toEqual(["b"]);
  const full: HistoryStorage = {
    getItem: () => "not json",
    setItem: () => {
      throw new Error("quota");
    },
  };
  const odd = createHistory(() => full);
  odd.add("c");
  expect(odd.entries()).toEqual(["c"]);
});

test("Up walks to older entries and stops at the oldest; Down walks back to the draft", () => {
  const entries = ["a", "b", "c"];
  const first = recall(entries, null, "older", "draft");
  expect(first).toEqual({ at: { index: 2, saved: "draft" }, text: "c" });
  const second = recall(entries, first?.at ?? null, "older", "c");
  expect(second).toEqual({ at: { index: 1, saved: "draft" }, text: "b" });
  const third = recall(entries, second?.at ?? null, "older", "b");
  expect(recall(entries, third?.at ?? null, "older", "a")).toBeNull();
  const back = recall(entries, third?.at ?? null, "newer", "a");
  expect(back?.text).toBe("b");
  const last = recall(entries, { index: 2, saved: "draft" }, "newer", "c");
  expect(last).toEqual({ at: null, text: "draft" });
  expect(recall(entries, null, "newer", "draft")).toBeNull();
  expect(recall([], null, "older", "")).toBeNull();
});
