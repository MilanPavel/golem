import assert from "node:assert/strict";
import { test } from "node:test";

import { connectGolem } from "./connect.ts";
import type { Dial } from "./link.ts";
import { startWsServer } from "./ws-test-server.ts";
import { wsDial } from "./ws-link.ts";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

test("close code 4401 sets unauthorized and is not redialed", async () => {
  const server = await startWsServer((socket) => socket.close(4401));
  let dials = 0;
  const dial: Dial = () => {
    dials += 1;
    return server.dial();
  };
  const client = connectGolem({ dial, clientName: "test", reconnect: true, backoff: () => 0 });
  const ready = assert.rejects(client.ready, /unauthorized/);
  await new Promise<void>((resolve) => {
    client.onState((state) => {
      if (state.status === "unauthorized") {
        resolve();
      }
    });
  });
  await ready;
  await settle();
  assert.equal(dials, 1);
  assert.deepEqual(client.state, { status: "unauthorized" });
  client.close();
  await server.stop();
});

test("a text message with a line break closes the link with bad frame", async () => {
  const server = await startWsServer();
  const link = server.dial();
  const lines: string[] = [];
  link.onLine((line) => lines.push(line));
  const closed = new Promise<Error | undefined>((resolve) => link.onClose((error) => resolve(error)));
  const socket = await server.acceptRaw();
  socket.send("a\nb");
  const error = await closed;
  assert.equal(error?.message, "bad frame");
  assert.deepEqual(lines, []);
  await server.stop();
});

test("a binary message closes the link with bad frame", async () => {
  const server = await startWsServer();
  const link = server.dial();
  const closed = new Promise<Error | undefined>((resolve) => link.onClose((error) => resolve(error)));
  const socket = await server.acceptRaw();
  socket.send(Buffer.from([1, 2, 3]));
  assert.equal((await closed)?.message, "bad frame");
  await server.stop();
});

test("an empty message is ignored", async () => {
  const server = await startWsServer();
  const link = server.dial();
  const lines: string[] = [];
  const got = new Promise<void>((resolve) =>
    link.onLine((line) => {
      lines.push(line);
      resolve();
    }),
  );
  const socket = await server.acceptRaw();
  socket.send("");
  socket.send("x");
  await got;
  assert.deepEqual(lines, ["x"]);
  link.close();
  await server.stop();
});

test("send before the link is open does nothing", async () => {
  const server = await startWsServer();
  const link = server.dial();
  link.send("early");
  const opened = new Promise<void>((resolve) => link.onOpen(resolve));
  const peer = await server.accept();
  await opened;
  link.send("late");
  assert.deepEqual(await peer.waitLines(1), ["late"]);
  await settle();
  assert.deepEqual(peer.lines, ["late"]);
  link.close();
  await server.stop();
});

test("a bad address closes once with an error", async () => {
  const link = wsDial("not a url")();
  const closes: Array<Error | undefined> = [];
  await new Promise<void>((resolve) =>
    link.onClose((error) => {
      closes.push(error);
      resolve();
    }),
  );
  await settle();
  assert.equal(closes.length, 1);
  assert.ok(closes[0] instanceof Error);
});

test("close ends the link at once, without waiting for the closing handshake", async () => {
  // A socket on a dead network: close() is accepted, but no close event ever arrives.
  class SilentSocket extends EventTarget {
    readyState = 1;
    close(): void {
      this.readyState = 2;
    }
    send(): void {}
  }
  const real = globalThis.WebSocket;
  globalThis.WebSocket = SilentSocket as unknown as typeof WebSocket;
  try {
    const link = wsDial("ws://127.0.0.1:1/")();
    const closed = new Promise<Error | undefined>((resolve) => link.onClose((error) => resolve(error)));
    link.close(new Error("heartbeat timeout"));
    const error = await closed;
    assert.equal(error?.message, "heartbeat timeout");
  } finally {
    globalThis.WebSocket = real;
  }
});
