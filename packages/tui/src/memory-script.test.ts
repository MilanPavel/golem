import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink";
import type { GolemClient, MemoryChanged, MemoryItem } from "@golem/client";
import { App } from "./app.tsx";

/**
 * The scripted TUI test of 5.1.10: a fake daemon that keeps memories in a list, a screen that is
 * driven by key presses. The chat step ("remember that I prefer pnpm") needs a model that calls
 * `remember`, so here the fake daemon makes that row and sends `memory.changed`, as the real one
 * does when the tool runs. Everything from `/memory` on goes through the real app.
 */
type Fake = { client: GolemClient; store: MemoryItem[]; changed: (change: MemoryChanged) => void; deleted: string[]; listCalls: number[] };

function fakeDaemon(options: { off?: boolean; items?: MemoryItem[] } = {}): Fake {
  const store: MemoryItem[] = [...(options.items ?? [])];
  const listeners = new Set<(change: MemoryChanged) => void>();
  const deleted: string[] = [];
  const listCalls: number[] = [];
  const base: Record<string, unknown> = {
    state: { status: "connected" },
    ready: Promise.resolve(),
    listSessions: async () => ({ sessions: [] }),
    createSession: async () => ({ session_id: "s_1" }),
    attachSession: async () => ({ replayed: 0 }),
    detachSession: async () => undefined,
    listMemories: async () => {
      listCalls.push(store.length);
      if (options.off === true) {
        throw new Error("memory is off: [memory] enabled = false");
      }
      const counts = { you: store.length, project: 0, history: 0 };
      return {
        items: [...store],
        total: store.length,
        counts,
        settings: { you: "chat", projects: "chat", history: "chat" },
      };
    },
    deleteMemories: async (ids: string[]) => {
      for (const id of ids) {
        const at = store.findIndex((item) => item.id === id);
        if (at >= 0) store.splice(at, 1);
        deleted.push(id);
      }
      return { deleted: ids, missing: [] };
    },
    onMemoryChanged: (listener: (change: MemoryChanged) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const client = new Proxy(base, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (/^on[A-Z]/.test(key)) return () => () => {};
      if (key === "close") return () => {};
      return () => new Promise(() => {});
    },
  }) as unknown as GolemClient;
  return { client, store, deleted, listCalls, changed: (change) => listeners.forEach((listener) => listener(change)) };
}

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true;
  frames: string[] = [];
  write(chunk: string): boolean {
    this.frames.push(chunk);
    return true;
  }
  last(): string {
    return this.frames.at(-1) ?? "";
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  queue: string[] = [];
  setRawMode(): this {
    return this;
  }
  setEncoding(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  read(): string | null {
    return this.queue.shift() ?? null;
  }
  type(text: string): void {
    this.queue.push(text);
    this.emit("readable");
  }
}

const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const pnpm: MemoryItem = {
  id: "m_1",
  scope: "you",
  author: "you",
  state: "kept",
  kept_by: "you",
  title: "I prefer pnpm",
  text: "I prefer pnpm",
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
};

async function start(fake: Fake) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const instance = render(createElement(App, { client: fake.client }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await wait(60);
  return {
    stdout,
    stdin,
    stop: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}

async function openMemory(stdin: FakeStdin): Promise<void> {
  for (const letter of "/memory") {
    stdin.type(letter);
    await wait(10);
  }
  await wait();
  stdin.type("\r");
  await wait(80);
}

test("the daemon holds a memory, /memory shows it, d then y deletes it", async () => {
  const fake = fakeDaemon();
  const screen = await start(fake);
  try {
    // "remember that I prefer pnpm": the daemon's `remember` tool writes this row and announces it.
    fake.store.push(pnpm);
    fake.changed({ id: "m_1", change: "created", scope: "you" });
    await openMemory(screen.stdin);
    assert.match(screen.stdout.last(), /Memory/);
    assert.match(screen.stdout.last(), /I prefer pnpm/);
    assert.match(screen.stdout.last(), /you said/);

    screen.stdin.type("d");
    await wait();
    assert.match(screen.stdout.last(), /delete\? y yes/);
    assert.deepEqual(fake.deleted, [], "nothing is deleted before the yes");

    screen.stdin.type("y");
    await wait(80);
    assert.deepEqual(fake.deleted, ["m_1"]);
    assert.match(screen.stdout.last(), /Nothing in You yet\./);
    assert.ok(!screen.stdout.last().includes("you said"), "the row is gone");

    screen.stdin.type("\u001b");
    await wait(80);
    assert.ok(!screen.stdout.last().includes("Nothing in You yet."), "Esc closes the manager");
  } finally {
    screen.stop();
  }
});

test("a memory.changed from the daemon reads the list again while /memory is open", async () => {
  const fake = fakeDaemon();
  const screen = await start(fake);
  try {
    await openMemory(screen.stdin);
    assert.match(screen.stdout.last(), /Nothing in You yet\./);
    const before = fake.listCalls.length;
    fake.store.push(pnpm);
    fake.changed({ id: "m_1", change: "created", scope: "you" });
    await wait(80);
    assert.ok(fake.listCalls.length > before, "the list was read again");
    assert.match(screen.stdout.last(), /I prefer pnpm/);
  } finally {
    screen.stop();
  }
});

test("when memory is off /memory says so and Esc leaves", async () => {
  const fake = fakeDaemon({ off: true });
  const screen = await start(fake);
  try {
    await openMemory(screen.stdin);
    assert.match(screen.stdout.last(), /memory is off: \[memory\] enabled = false/);
  } finally {
    screen.stop();
  }
});
