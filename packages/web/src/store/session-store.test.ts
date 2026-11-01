import { expect, test, vi } from "vitest";
import { createSessionStore } from "./session-store.ts";
import { ev, fakeFrame } from "./test-support.ts";

const started = (id = "m1") => ev("s", "message.started", { message_id: id, role: "assistant" });
const delta = (text: string, id = "m1") => ev("s", "message.delta", { message_id: id, text });
const lastText = (store: ReturnType<typeof createSessionStore>) =>
  store.getSnapshot().chat.messages.at(-1)?.text;

test("deltas wait for the frame and several fold in one notification", () => {
  const frame = fakeFrame();
  const store = createSessionStore(frame);
  store.dispatch(started());
  const listener = vi.fn();
  store.subscribe(listener);
  store.dispatch(delta("Hel"));
  store.dispatch(delta("lo"));
  store.dispatch(delta("!", "m1"));
  expect(frame.request).toHaveBeenCalledTimes(1);
  expect(lastText(store)).toBe("");
  expect(listener).not.toHaveBeenCalled();
  frame.run();
  expect(lastText(store)).toBe("Hello!");
  expect(listener).toHaveBeenCalledTimes(1);
});

test("a non-delta event flushes pending deltas first and applies at once with no frame", () => {
  const frame = fakeFrame();
  const store = createSessionStore(frame);
  store.dispatch(started());
  store.dispatch(delta("abc"));
  const listener = vi.fn();
  store.subscribe(listener);
  store.dispatch(ev("s", "message.completed", { message_id: "m1", role: "assistant", text: "abc" }));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(lastText(store)).toBe("abc");
  expect(store.getSnapshot().chat.messages.at(-1)?.streaming).toBeFalsy();
  expect(frame.cancel).toHaveBeenCalled();
  expect(frame.pending()).toBe(0);
});

test("the order of deltas and a later event is kept", () => {
  const frame = fakeFrame();
  const store = createSessionStore(frame);
  store.dispatch(started());
  store.dispatch(delta("one"));
  store.dispatch(ev("s", "run.completed", {}));
  store.dispatch(delta(" two"));
  frame.run();
  expect(lastText(store)).toBe("one two");
});

test("title, folder, and model come from session.created, model.selected, and session.updated", () => {
  const store = createSessionStore(fakeFrame());
  expect(store.getSnapshot()).toMatchObject({ title: null, cwd: null, model: null, status: "attaching" });
  store.dispatch(ev("s", "session.created", { cwd: "/repo", model_profile: "fast", model_provider: "ollama", model_name: "q" }));
  expect(store.getSnapshot()).toMatchObject({ cwd: "/repo", model: { profile: "fast", provider: "ollama", name: "q" } });
  store.dispatch(ev("s", "model.selected", { reason: "user", model_profile: "big" }));
  expect(store.getSnapshot().model).toEqual({ profile: "big", provider: null, name: null });
  store.dispatch(ev("s", "session.updated", { title: "Fix it", cwd: "/other" }));
  expect(store.getSnapshot()).toMatchObject({ title: "Fix it", cwd: "/other" });
  store.dispatch(ev("s", "session.updated", { title: null }));
  expect(store.getSnapshot().title).toBe("Fix it");
});

test("an event that changes nothing does not notify", () => {
  const store = createSessionStore(fakeFrame());
  store.dispatch(ev("s", "session.updated", { title: "T" }));
  const listener = vi.fn();
  store.subscribe(listener);
  store.dispatch(ev("s", "session.updated", { title: "T" }));
  expect(listener).not.toHaveBeenCalled();
});

test("setStatus changes the status once", () => {
  const store = createSessionStore(fakeFrame());
  const listener = vi.fn();
  store.subscribe(listener);
  store.setStatus("ready");
  store.setStatus("ready");
  expect(store.getSnapshot().status).toBe("ready");
  expect(listener).toHaveBeenCalledTimes(1);
});

test("dispose cancels a pending frame", () => {
  const frame = fakeFrame();
  const store = createSessionStore(frame);
  store.dispatch(started());
  store.dispatch(delta("x"));
  expect(frame.pending()).toBe(1);
  store.dispose();
  expect(frame.cancel).toHaveBeenCalledTimes(1);
  expect(frame.pending()).toBe(0);
});
