import { expect, test, vi } from "vitest";
import { createSessionList } from "./session-list.ts";
import { fakeClient, summary } from "./test-support.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("summaries merge newest first, and closed ones leave", () => {
  const fake = fakeClient();
  const list = createSessionList(fake.client);
  list.start();
  const listener = vi.fn();
  list.subscribe(listener);
  fake.emitSummary(summary("a", "2026-11-01T10:00:00Z"));
  fake.emitSummary(summary("b", "2026-11-01T11:00:00Z"));
  expect(list.getSnapshot().map((s) => s.session_id)).toEqual(["b", "a"]);
  fake.emitSummary({ ...summary("b", "2026-11-01T11:00:00Z", null, 2), status: "closed" });
  expect(list.getSnapshot().map((s) => s.session_id)).toEqual(["a"]);
  expect(listener).toHaveBeenCalledTimes(3);
});

test("start watches once the client is ready, and only once", async () => {
  const fake = fakeClient();
  const list = createSessionList(fake.client);
  list.start();
  list.start();
  await tick();
  expect(fake.raw.watchSessions).toHaveBeenCalledTimes(1);
});

test("a client that never gets ready does not throw", async () => {
  const fake = fakeClient();
  const rejected = Promise.reject(new Error("rejected"));
  rejected.catch(() => undefined);
  const list = createSessionList({ ...fake.client, ready: rejected });
  list.start();
  await tick();
  expect(fake.raw.watchSessions).not.toHaveBeenCalled();
});
