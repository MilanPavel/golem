// The relay started the way the container starts it: the entrypoint as a process, settings from
// the environment, then two clients over real sockets.
import { afterEach, expect, test } from "bun:test";

import { authMessage, toBase64Url } from "../core.ts";
import { newIdentity } from "../test-client.ts";

let child: ReturnType<typeof Bun.spawn> | undefined;
afterEach(() => {
  child?.kill();
  child = undefined;
});

function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

async function ready(port: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the relay did not start");
}

function open(port: number, path: string) {
  return new Promise<{ ws: WebSocket; inbox: (string | Uint8Array)[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.binaryType = "arraybuffer";
    const inbox: (string | Uint8Array)[] = [];
    ws.addEventListener("message", (e) => inbox.push(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer)));
    ws.addEventListener("open", () => resolve({ ws, inbox }));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}

async function next(inbox: unknown[], n: number): Promise<void> {
  for (let i = 0; i < 500 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 4));
  expect(inbox.length).toBeGreaterThanOrEqual(n);
}

test("two clients reach each other through the entrypoint, set up by environment", async () => {
  const port = freePort();
  child = Bun.spawn(["bun", "src/bun/main.ts"], {
    env: { PATH: process.env["PATH"] ?? "", RELAY_HOST: "relay.test", BIND: `127.0.0.1:${port}` },
    stdout: "ignore",
    stderr: "ignore",
  });
  await ready(port);

  const mac = await open(port, "/v1/mac");
  const macId = await newIdentity();
  await next(mac.inbox, 1);
  const macNonce = (JSON.parse(mac.inbox[0] as string) as { nonce: string }).nonce;
  const macSig = await macId.sign(authMessage("mac", "relay.test", macNonce));
  mac.ws.send(JSON.stringify({ type: "auth", v: 1, key: macId.publicKey, sig: toBase64Url(macSig) }));
  const phone = await newIdentity();
  mac.ws.send(JSON.stringify({ type: "allow", seq: 1, devices: [{ key: phone.publicKey }], pairs: [] }));
  await new Promise((r) => setTimeout(r, 30));

  const dev = await open(port, "/v1/device");
  await next(dev.inbox, 1);
  const nonce = (JSON.parse(dev.inbox[0] as string) as { nonce: string }).nonce;
  const sig = await phone.sign(authMessage("device", "relay.test", nonce));
  dev.ws.send(JSON.stringify({ type: "auth", v: 1, key: phone.publicKey, sig: toBase64Url(sig), mac: await macId.roomId() }));
  await next(dev.inbox, 2);

  dev.ws.send(new Uint8Array([1, 0, 0, 0, 7, 42, 43]));
  await next(mac.inbox, 3);
  const frame = mac.inbox.find((m): m is Uint8Array => typeof m !== "string")!;
  expect([...frame.slice(-2)]).toEqual([42, 43]);
  mac.ws.close();
  dev.ws.close();
});

test("the entrypoint refuses to start without RELAY_HOST", async () => {
  const proc = Bun.spawn(["bun", "src/bun/main.ts"], { env: { PATH: process.env["PATH"] ?? "" }, stdout: "ignore", stderr: "ignore" });
  expect(await proc.exited).not.toBe(0);
});
