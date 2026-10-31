import assert from "node:assert/strict";
import { test } from "node:test";

import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { connectGolem, type ConnectionState } from "./connect.ts";
import type { Dial, Link } from "./link.ts";

/** The server side of one accepted connection. */
export interface Peer {
  send(line: string): void;
  /** Closes the connection. `code` is a WebSocket close code; a Unix socket ignores it. */
  close(code?: number): void;
  /** Every line received so far. */
  readonly lines: string[];
  /** Resolves once `count` lines have been received, with all lines so far. */
  waitLines(count: number): Promise<string[]>;
  onLine(listener: (line: string) => void): void;
}

/** A server for one transport, and the dial that reaches it. */
export interface Rig {
  dial: Dial;
  /** The next connection the server accepts. */
  accept(): Promise<Peer>;
  stop(): Promise<void>;
}

/** Hands out values in order, to whoever asks first or whenever they arrive. */
export function queue<T>(): { push(value: T): void; next(): Promise<T> } {
  const values: T[] = [];
  const waiters: Array<(value: T) => void> = [];
  return {
    push(value) {
      const waiter = waiters.shift();
      if (waiter === undefined) {
        values.push(value);
      } else {
        waiter(value);
      }
    },
    next() {
      const value = values.shift();
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      return new Promise<T>((resolve) => waiters.push(resolve));
    },
  };
}

/** A peer built from how a transport writes and closes. `feed` takes each received line. */
export function makePeer(
  write: (line: string) => void,
  close: (code?: number) => void,
): { peer: Peer; feed(line: string): void } {
  const lines: string[] = [];
  const listeners: Array<(line: string) => void> = [];
  const counters: Array<{ count: number; resolve: (lines: string[]) => void }> = [];
  const peer: Peer = {
    send: write,
    close,
    lines,
    waitLines(count) {
      if (lines.length >= count) {
        return Promise.resolve([...lines]);
      }
      return new Promise((resolve) => counters.push({ count, resolve }));
    },
    onLine(listener) {
      listeners.push(listener);
    },
  };
  return {
    peer,
    feed(line) {
      lines.push(line);
      for (const listener of listeners) {
        listener(line);
      }
      for (const counter of counters.filter((c) => lines.length >= c.count)) {
        counter.resolve([...lines]);
      }
    },
  };
}

interface Closure {
  error: Error | undefined;
  code: number | undefined;
}

function watch(link: Link): { opened: Promise<void>; closes: Closure[]; closed: Promise<Closure> } {
  const closes: Closure[] = [];
  const opened = new Promise<void>((resolve) => link.onOpen(resolve));
  const closed = new Promise<Closure>((resolve) => {
    link.onClose((error, code) => {
      closes.push({ error, code });
      resolve({ error, code });
    });
  });
  return { opened, closes, closed };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

async function withRig(makeRig: () => Promise<Rig>, body: (rig: Rig) => Promise<void>): Promise<void> {
  const rig = await makeRig();
  try {
    await body(rig);
  } finally {
    await rig.stop();
  }
}

/** The behaviour every Link must have, whatever the transport. */
export function linkContract(name: string, makeRig: () => Promise<Rig>): void {
  test(`${name}: the link opens`, () =>
    withRig(makeRig, async (rig) => {
      const link = rig.dial();
      const { opened } = watch(link);
      await opened;
      await rig.accept();
      link.close();
    }));

  test(`${name}: lines go both ways, multi-byte characters included`, () =>
    withRig(makeRig, async (rig) => {
      const link = rig.dial();
      const { opened } = watch(link);
      const received = new Promise<string>((resolve) => link.onLine(resolve));
      const peer = await rig.accept();
      await opened;
      link.send("ž🙂 to the server");
      assert.deepEqual(await peer.waitLines(1), ["ž🙂 to the server"]);
      peer.send("ž🙂 to the client");
      assert.equal(await received, "ž🙂 to the client");
      link.close();
    }));

  test(`${name}: several lines arrive in order`, () =>
    withRig(makeRig, async (rig) => {
      const link = rig.dial();
      const { opened } = watch(link);
      const got: string[] = [];
      const all = new Promise<void>((resolve) =>
        link.onLine((line) => {
          got.push(line);
          if (got.length === 3) {
            resolve();
          }
        }),
      );
      const peer = await rig.accept();
      await opened;
      for (const line of ["one", "two", "three"]) {
        peer.send(line);
        link.send(line);
      }
      await all;
      assert.deepEqual(got, ["one", "two", "three"]);
      assert.deepEqual(await peer.waitLines(3), ["one", "two", "three"]);
      link.close();
    }));

  test(`${name}: a close by the server fires onClose once`, () =>
    withRig(makeRig, async (rig) => {
      const link = rig.dial();
      const { opened, closes, closed } = watch(link);
      const peer = await rig.accept();
      await opened;
      peer.close();
      await closed;
      await settle();
      assert.equal(closes.length, 1);
    }));

  test(`${name}: close(error) fires onClose once with that error`, () =>
    withRig(makeRig, async (rig) => {
      const link = rig.dial();
      const { opened, closes, closed } = watch(link);
      await rig.accept();
      await opened;
      link.close(new Error("bye"));
      const closure = await closed;
      await settle();
      assert.equal(closure.error?.message, "bye");
      assert.equal(closes.length, 1);
    }));

  test(`${name}: dialing again gives a fresh working link`, () =>
    withRig(makeRig, async (rig) => {
      const first = rig.dial();
      const firstWatch = watch(first);
      await rig.accept();
      await firstWatch.opened;
      first.close();
      await firstWatch.closed;

      const second = rig.dial();
      const secondWatch = watch(second);
      const reply = new Promise<string>((resolve) => second.onLine(resolve));
      const peer = await rig.accept();
      await secondWatch.opened;
      second.send("again");
      assert.deepEqual(await peer.waitLines(1), ["again"]);
      peer.send("welcome back");
      assert.equal(await reply, "welcome back");
      second.close();
    }));

  // Real timers, 20 ms and 40 ms: mock timers do not reach the sockets' own I/O, so the
  // interval and the timeout run on the real clock to keep the case reliable.
  test(`${name}: a peer that never answers ping makes the client reconnect`, () =>
    withRig(makeRig, async (rig) => {
      const client = connectGolem({
        dial: rig.dial,
        clientName: "contract",
        reconnect: true,
        heartbeatMs: 20,
        heartbeatTimeoutMs: 40,
        backoff: () => 50,
      });
      const states: ConnectionState[] = [];
      const reconnecting = new Promise<void>((resolve) => {
        client.onState((state) => {
          states.push(state);
          if (state.status === "reconnecting") {
            resolve();
          }
        });
      });
      const peer = await rig.accept();
      peer.onLine((line) => {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method !== "hello") {
          return;
        }
        const result = { daemon_version: "test", protocol_major: PROTOCOL_MAJOR, protocol_minor: PROTOCOL_MINOR };
        peer.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      });
      await client.ready;
      assert.equal(client.state.status, "connected");
      await reconnecting;
      assert.ok(states.some((state) => state.status === "reconnecting"));
      client.close();
    }));
}
