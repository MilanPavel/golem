import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { unixDial } from "./unix-link.ts";

interface Rig {
  server: Server;
  socketPath: string;
  accepted: Promise<Socket>;
  dir: string;
}

async function rig(): Promise<Rig> {
  const dir = mkdtempSync(path.join(tmpdir(), "golem-link-"));
  const socketPath = path.join(dir, "s.sock");
  let accept: (socket: Socket) => void = () => undefined;
  const accepted = new Promise<Socket>((resolve) => {
    accept = resolve;
  });
  const server = createServer(accept);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, socketPath, accepted, dir };
}

async function stop(r: Rig): Promise<void> {
  await new Promise<void>((resolve) => r.server.close(() => resolve()));
  rmSync(r.dir, { recursive: true, force: true });
}

function collect(socketPath: string, want: number) {
  const link = unixDial(socketPath)();
  const lines: string[] = [];
  const done = new Promise<void>((resolve) => {
    link.onLine((line) => {
      lines.push(line);
      if (lines.length >= want) {
        resolve();
      }
    });
  });
  return { link, lines, done };
}

test("a character split across two chunks arrives whole", async () => {
  const r = await rig();
  const { link, lines, done } = collect(r.socketPath, 1);
  const server = await r.accepted;
  server.write(Buffer.from([0xc3]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  server.write(Buffer.from([0xa9, 0x0a]));
  await done;
  assert.deepEqual(lines, ["é"]);
  link.close();
  await stop(r);
});

test("lines are split on newline, a trailing CR is stripped, empty lines are skipped", async () => {
  const r = await rig();
  const { link, lines, done } = collect(r.socketPath, 2);
  const server = await r.accepted;
  server.write("a\r\n\nb\n");
  await done;
  assert.deepEqual(lines, ["a", "b"]);
  link.close();
  await stop(r);
});

test("send writes the line and a newline", async () => {
  const r = await rig();
  const link = unixDial(r.socketPath)();
  const server = await r.accepted;
  const received = new Promise<string>((resolve) => {
    server.once("data", (chunk) => resolve(chunk.toString("utf8")));
  });
  link.onOpen(() => link.send("x"));
  assert.equal(await received, "x\n");
  link.close();
  await stop(r);
});

test("dialing a path with no server closes once with an error and never opens", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "golem-link-"));
  const link = unixDial(path.join(dir, "none.sock"))();
  let opened = false;
  link.onOpen(() => {
    opened = true;
  });
  const closes: Array<Error | undefined> = [];
  await new Promise<void>((resolve) => {
    link.onClose((error) => {
      closes.push(error);
      resolve();
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(opened, false);
  assert.equal(closes.length, 1);
  assert.ok(closes[0] instanceof Error);
  rmSync(dir, { recursive: true, force: true });
});

test("close with an error reports that error once", async () => {
  const r = await rig();
  const link = unixDial(r.socketPath)();
  const closes: Array<Error | undefined> = [];
  const closed = new Promise<void>((resolve) => {
    link.onClose((error) => {
      closes.push(error);
      resolve();
    });
  });
  link.onOpen(() => link.close(new Error("bye")));
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closes.length, 1);
  assert.equal(closes[0]?.message, "bye");
  await stop(r);
});
