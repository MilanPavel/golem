import type { ConnectionState } from "@golem/client";
import { expect, test, vi } from "vitest";
import { createConnectionStore, type ConnectionClient } from "./connection.ts";

function fakeClient(version: () => Promise<string>) {
  const listeners = new Set<(state: ConnectionState) => void>();
  let state: ConnectionState = { status: "connecting" };
  const client = {
    get state() {
      return state;
    },
    onState(listener: (state: ConnectionState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: vi.fn(async () => ({ version: await version() })),
    close: vi.fn(),
  };
  return {
    client: client as unknown as ConnectionClient,
    raw: client,
    emit(next: ConnectionState) {
      state = next;
      for (const listener of listeners) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("the snapshot changes with the state and is the same object otherwise", () => {
  const fake = fakeClient(async () => "1.0.0");
  const store = createConnectionStore(() => fake.client);
  const listener = vi.fn();
  store.subscribe(listener);
  const first = store.getSnapshot();
  expect(first).toEqual({ state: { status: "connecting" }, daemonVersion: null });
  store.start();
  expect(store.getSnapshot()).toBe(first);
  expect(listener).not.toHaveBeenCalled();
  fake.emit({ status: "unauthorized" });
  const second = store.getSnapshot();
  expect(second).not.toBe(first);
  expect(second.state).toEqual({ status: "unauthorized" });
  expect(store.getSnapshot()).toBe(second);
  expect(listener).toHaveBeenCalledTimes(1);
});

test("the version is read after connected and kept when a later read fails", async () => {
  let next: () => Promise<string> = async () => "1.2.3";
  const fake = fakeClient(() => next());
  const store = createConnectionStore(() => fake.client);
  store.start();
  fake.emit({ status: "connected" });
  expect(store.getSnapshot().daemonVersion).toBeNull();
  await flush();
  expect(store.getSnapshot()).toEqual({ state: { status: "connected" }, daemonVersion: "1.2.3" });

  fake.emit({ status: "reconnecting", attempt: 1, delayMs: 0, closeCode: 1013 });
  next = async () => {
    throw new Error("gone");
  };
  fake.emit({ status: "connected" });
  await flush();
  expect(store.getSnapshot()).toEqual({ state: { status: "connected" }, daemonVersion: "1.2.3" });
  expect(fake.raw.status).toHaveBeenCalledTimes(2);
});

test("stop closes the client and unsubscribes; start can run again", () => {
  const fake = fakeClient(async () => "1");
  const connect = vi.fn(() => fake.client);
  const store = createConnectionStore(connect);
  store.start();
  store.start();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(fake.listenerCount()).toBe(1);
  store.stop();
  expect(fake.raw.close).toHaveBeenCalledTimes(1);
  expect(fake.listenerCount()).toBe(0);
  store.start();
  expect(connect).toHaveBeenCalledTimes(2);
});
