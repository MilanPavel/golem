import { RpcError, SESSION_NOT_FOUND } from "@golem/client";
import { expect, test } from "vitest";
import { createSessions } from "./sessions.ts";
import { ev, fakeClient, fakeFrame } from "./test-support.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("events go to the store of their session, and unopened sessions are ignored", async () => {
  const fake = fakeClient();
  const sessions = createSessions(fake.client, fakeFrame());
  const a = sessions.open("a");
  const b = sessions.open("b");
  fake.emitEvent(ev("a", "session.updated", { title: "A" }));
  fake.emitEvent(ev("zzz", "session.updated", { title: "Z" }));
  expect(a.getSnapshot().title).toBe("A");
  expect(b.getSnapshot().title).toBeNull();
  expect(sessions.get("zzz")).toBeUndefined();
});

test("open attaches from the start, becomes ready, and is idempotent", async () => {
  const fake = fakeClient();
  const sessions = createSessions(fake.client, fakeFrame());
  const store = sessions.open("a");
  expect(store.getSnapshot().status).toBe("attaching");
  expect(sessions.open("a")).toBe(store);
  await tick();
  expect(fake.raw.attachSession).toHaveBeenCalledTimes(1);
  expect(fake.raw.attachSession).toHaveBeenCalledWith("a");
  expect(store.getSnapshot().status).toBe("ready");
});

test("SESSION_NOT_FOUND makes the session gone", async () => {
  const fake = fakeClient();
  fake.raw.attachSession.mockRejectedValueOnce(new RpcError(SESSION_NOT_FOUND, "no such session"));
  const sessions = createSessions(fake.client, fakeFrame());
  const store = sessions.open("a");
  await tick();
  expect(store.getSnapshot().status).toBe("gone");
});

test("another attach failure leaves the session attaching", async () => {
  const fake = fakeClient();
  fake.raw.attachSession.mockRejectedValueOnce(new Error("not connected"));
  const sessions = createSessions(fake.client, fakeFrame());
  const store = sessions.open("a");
  await tick();
  expect(store.getSnapshot().status).toBe("attaching");
});

test("close detaches, ignores a detach error, and disposes and drops the store", async () => {
  const fake = fakeClient();
  fake.raw.detachSession.mockRejectedValueOnce(new Error("gone"));
  const frame = fakeFrame();
  const sessions = createSessions(fake.client, frame);
  const store = sessions.open("a");
  fake.emitEvent(ev("a", "message.started", { message_id: "m", role: "assistant" }));
  fake.emitEvent(ev("a", "message.delta", { message_id: "m", text: "x" }));
  expect(frame.pending()).toBe(1);
  sessions.close("a");
  await tick();
  expect(fake.raw.detachSession).toHaveBeenCalledWith("a");
  expect(frame.pending()).toBe(0);
  expect(sessions.get("a")).toBeUndefined();
  fake.emitEvent(ev("a", "session.updated", { title: "late" }));
  expect(store.getSnapshot().title).toBeNull();
});

test("stop drops the client listener", () => {
  const fake = fakeClient();
  const sessions = createSessions(fake.client, fakeFrame());
  expect(fake.eventListeners()).toBe(1);
  sessions.stop();
  expect(fake.eventListeners()).toBe(0);
});
