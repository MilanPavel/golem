import { describe, expect, test } from "bun:test";

import { createHub } from "./hub.ts";
import type { HubOptions } from "./hub.ts";
import { createLogger } from "./log.ts";
import { toBase64Url } from "./protocol.ts";
import { connect, deviceFrame, macFrame, newIdentity, until } from "./test-client.ts";
import type { Identity, TestSocket } from "./test-client.ts";

const HOST = "relay.test";

function setup(options: Partial<HubOptions> = {}) {
  const clock = { now: 1_000_000 };
  const lines: string[] = [];
  const hub = createHub({
    host: HOST,
    now: () => clock.now,
    log: createLogger((l) => lines.push(l), () => clock.now),
    ...options,
  });
  return { hub, clock, lines };
}

async function macOnline(hub: ReturnType<typeof setup>["hub"], devices: Identity[], seq = 1) {
  const mac = await newIdentity();
  const sock = connect(hub, "mac", HOST);
  await sock.auth(mac);
  await until(() => sock.closed !== null || sock.handler !== undefined);
  allow(sock, devices, seq);
  const room = await mac.roomId();
  await until(() => hub.stats().rooms === 1, "room");
  await new Promise((r) => setTimeout(r, 5));
  return { mac, sock, room };
}

function allow(sock: TestSocket, devices: Identity[], seq: number): void {
  sock.send(JSON.stringify({ type: "allow", seq, devices: devices.map((d) => ({ key: d.publicKey })), pairs: [] }));
}

async function deviceOnline(hub: ReturnType<typeof setup>["hub"], id: Identity, room: string) {
  const sock = connect(hub, "device", HOST);
  await sock.auth(id, { mac: room });
  await until(() => sock.closed !== null || sock.json().some((m) => m["type"] === "peer"), "device admitted");
  return sock;
}

const text = (s: string) => new TextEncoder().encode(s);

describe("authentication", () => {
  test("the challenge carries a fresh nonce", () => {
    const { hub } = setup();
    const a = connect(hub, "mac", HOST);
    const b = connect(hub, "mac", HOST, "10.0.0.2");
    expect(a.json()[0]).toMatchObject({ type: "challenge", v: 1 });
    expect(a.challenge()).not.toBe(b.challenge());
  });

  test("a wrong signature is closed with 4401", async () => {
    const { hub } = setup();
    const sock = connect(hub, "mac", HOST);
    const mac = await newIdentity();
    const other = await newIdentity();
    const sig = await other.sign(text("nonsense"));
    sock.send(JSON.stringify({ type: "auth", v: 1, key: mac.publicKey, sig: toBase64Url(sig) }));
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4401);
  });

  test("a signature made for another relay host is refused", async () => {
    const { hub } = setup();
    const sock = connect(hub, "mac", "evil.test");
    await sock.auth(await newIdentity());
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4401);
  });

  test("a signature made for the other role is refused", async () => {
    const { hub } = setup();
    const sock = connect(hub, "mac", HOST);
    await sock.auth(await newIdentity(), {}, "device");
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4401);
  });

  test("no answer in time is 4401", async () => {
    const { hub } = setup({ authTimeoutMs: 20 });
    const sock = connect(hub, "mac", HOST);
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4401);
  });

  test("something that is not JSON before auth is 4400", async () => {
    const { hub } = setup();
    const sock = connect(hub, "mac", HOST);
    sock.send("hello");
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4400);
  });

  test("a binary frame before auth is 4400", async () => {
    const { hub } = setup();
    const sock = connect(hub, "device", HOST);
    sock.send(new Uint8Array([1, 2, 3]));
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4400);
  });

  test("a second Mac socket replaces the first with 4409", async () => {
    const { hub } = setup();
    const mac = await newIdentity();
    const first = connect(hub, "mac", HOST);
    await first.auth(mac);
    await until(() => hub.stats().rooms === 1);
    const second = connect(hub, "mac", HOST, "10.0.0.2");
    await second.auth(mac);
    await until(() => first.closed !== null);
    expect(first.closed).toBe(4409);
    expect(second.closed).toBeNull();
  });
});

describe("rooms and frames", () => {
  test("a Mac and a device exchange frames unchanged", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const dev = await deviceOnline(hub, phone, room);
    const id = await phone.deviceId();

    dev.send(deviceFrame([1, 2, 3, 4], text("hello mac")));
    await until(() => mac.binary().length === 1, "frame at the Mac");
    expect(mac.binary()[0]).toEqual(macFrame(id, [1, 2, 3, 4], text("hello mac")));

    mac.send(macFrame(id, [1, 2, 3, 4], text("hello phone")));
    await until(() => dev.binary().length === 1, "frame at the device");
    expect(dev.binary()[0]).toEqual(deviceFrame([1, 2, 3, 4], text("hello phone")));
  });

  test("peer messages say when the other side comes and goes", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const dev = await deviceOnline(hub, phone, room);
    expect(dev.json().find((m) => m["type"] === "peer")).toMatchObject({ state: "online" });
    expect(mac.json().find((m) => m["type"] === "peer")).toMatchObject({ state: "online" });
    mac.handler.close();
    await until(() => dev.json().some((m) => m["type"] === "peer" && m["state"] === "offline"));
  });

  test("a device that is not on the list is closed with 4401", async () => {
    const { hub } = setup();
    const listed = await newIdentity();
    const stranger = await newIdentity();
    const { room } = await macOnline(hub, [listed]);
    const sock = connect(hub, "device", HOST);
    await sock.auth(stranger, { mac: room });
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4401);
  });

  test("a device for an unknown room is told to try later, not to pair again", async () => {
    const { hub } = setup();
    const sock = connect(hub, "device", HOST);
    await sock.auth(await newIdentity(), { mac: "nothing" });
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(1013);
  });

  test("a frame over 32 KiB is refused with 4413", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { room } = await macOnline(hub, [phone]);
    const dev = await deviceOnline(hub, phone, room);
    dev.send(deviceFrame([0, 0, 0, 1], new Uint8Array(32 * 1024)));
    expect(dev.closed).toBe(4413);
  });

  test("a frame of exactly 32 KiB passes", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const dev = await deviceOnline(hub, phone, room);
    dev.send(deviceFrame([0, 0, 0, 1], new Uint8Array(32 * 1024 - 5)));
    await until(() => mac.binary().length === 1);
    expect(dev.closed).toBeNull();
  });

  test("anything that is not one frame is refused with 4400", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { room } = await macOnline(hub, [phone]);
    for (const bad of [new Uint8Array([2, 0, 0, 0, 0, 9]), new Uint8Array([1, 0, 0]), "{\"type\":\"nope\"}", "not json"]) {
      const dev = await deviceOnline(hub, phone, room);
      dev.send(bad);
      await until(() => dev.closed !== null);
      expect(dev.closed).toBe(4400);
    }
  });

  test("a third socket for one device closes the oldest with 4409", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { room } = await macOnline(hub, [phone]);
    const a = await deviceOnline(hub, phone, room);
    const b = await deviceOnline(hub, phone, room);
    const c = await deviceOnline(hub, phone, room);
    expect(a.closed).toBe(4409);
    expect(b.closed).toBeNull();
    expect(c.closed).toBeNull();
  });

  test("a list of more than 16 devices is refused with an error, and the old list stays", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const many = await Promise.all(Array.from({ length: 17 }, () => newIdentity()));
    allow(mac, many, 2);
    await until(() => mac.json().some((m) => m["type"] === "error"));
    const dev = await deviceOnline(hub, phone, room);
    expect(dev.closed).toBeNull();
  });

  test("a lower seq is ignored", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone], 5);
    allow(mac, [], 4);
    await new Promise((r) => setTimeout(r, 10));
    const dev = await deviceOnline(hub, phone, room);
    expect(dev.closed).toBeNull();
  });
});

describe("revoke", () => {
  test("a new list without a device closes its live sockets at once with 4403", async () => {
    const { hub } = setup();
    const keep = await newIdentity();
    const drop = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [keep, drop]);
    const kept = await deviceOnline(hub, keep, room);
    const dropped = await deviceOnline(hub, drop, room);
    allow(mac, [keep], 2);
    await until(() => dropped.closed !== null);
    expect(dropped.closed).toBe(4403);
    expect(kept.closed).toBeNull();
    const again = connect(hub, "device", HOST);
    await again.auth(drop, { mac: room });
    await until(() => again.closed !== null);
    expect(again.closed).toBe(4401);
  });

  test("frames queued for a revoked device are dropped", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac } = await macOnline(hub, [phone]);
    mac.send(macFrame(await phone.deviceId(), [0, 0, 0, 1], text("late")));
    await until(() => hub.heldFrames().length === 1);
    allow(mac, [], 2);
    await until(() => hub.heldFrames().length === 0);
  });
});

describe("the queue", () => {
  test("a frame for a device that is away is delivered when it reconnects within the TTL", async () => {
    const { hub, clock } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    mac.send(macFrame(await phone.deviceId(), [9, 9, 9, 9], text("wait for me")));
    await until(() => hub.heldFrames().length === 1);
    clock.now += 30_000;
    const dev = await deviceOnline(hub, phone, room);
    await until(() => dev.binary().length === 1);
    expect(dev.binary()[0]).toEqual(deviceFrame([9, 9, 9, 9], text("wait for me")));
  });

  test("a frame is dropped after the TTL", async () => {
    const { hub, clock } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    mac.send(macFrame(await phone.deviceId(), [9, 9, 9, 9], text("too late")));
    await until(() => hub.heldFrames().length === 1);
    clock.now += 61_000;
    const dev = await deviceOnline(hub, phone, room);
    await new Promise((r) => setTimeout(r, 10));
    expect(dev.binary().length).toBe(0);
  });

  test("a device's frame waits for a Mac that drops and comes back", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const mac = await newIdentity();
    const first = connect(hub, "mac", HOST);
    await first.auth(mac);
    await until(() => hub.stats().rooms === 1);
    allow(first, [phone], 1);
    await new Promise((r) => setTimeout(r, 5));
    const room = await mac.roomId();
    const dev = await deviceOnline(hub, phone, room);
    first.handler.close();
    dev.send(deviceFrame([1, 1, 1, 1], text("hello?")));
    const second = connect(hub, "mac", HOST, "10.0.0.3");
    await second.auth(mac);
    await until(() => second.binary().length === 1);
    expect(second.binary()[0]).toEqual(macFrame(await phone.deviceId(), [1, 1, 1, 1], text("hello?")));
  });

  test("the queue keeps 64 frames and drops the oldest", async () => {
    const { hub } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const id = await phone.deviceId();
    for (let i = 0; i < 70; i++) mac.send(macFrame(id, [0, 0, 0, 1], new Uint8Array([i])));
    const dev = await deviceOnline(hub, phone, room);
    await until(() => dev.binary().length === 64);
    expect(dev.binary()[0]?.at(-1)).toBe(6);
  });
});

describe("limits", () => {
  test("a socket that sends too fast gets 4429", async () => {
    const { hub } = setup({ framesPerSecond: 1, frameBurst: 3 });
    const phone = await newIdentity();
    const { room } = await macOnline(hub, [phone]);
    const dev = await deviceOnline(hub, phone, room);
    for (let i = 0; i < 10; i++) dev.send(deviceFrame([0, 0, 0, 1], text("x")));
    expect(dev.closed).toBe(4429);
  });

  test("more than 10 new connections a minute from one IP get 4429", () => {
    const { hub } = setup();
    const socks = Array.from({ length: 11 }, () => connect(hub, "mac", HOST, "9.9.9.9"));
    expect(socks.slice(0, 10).every((s) => s.closed === null)).toBe(true);
    expect(socks[10]?.closed).toBe(4429);
  });

  test("a full relay answers 1013", () => {
    const { hub } = setup({ maxSockets: 1 });
    connect(hub, "mac", HOST, "1.1.1.1");
    expect(connect(hub, "mac", HOST, "1.1.1.2").closed).toBe(1013);
  });

  test("a socket idle for too long gets 4408", async () => {
    const { hub } = setup({ idleMs: 20, authTimeoutMs: 5_000, now: Date.now });
    const sock = connect(hub, "mac", HOST);
    await sock.auth(await newIdentity());
    await until(() => sock.closed !== null);
    expect(sock.closed).toBe(4408);
  });

  test("a Mac's push gets push_not_configured until pushes exist", async () => {
    const { hub } = setup();
    const { sock: mac } = await macOnline(hub, []);
    mac.send(JSON.stringify({ type: "push" }));
    await until(() => mac.json().some((m) => m["type"] === "push_result"));
    expect(mac.json().find((m) => m["type"] === "push_result")).toMatchObject({ ok: false, reason: "push_not_configured" });
  });

  test("sweep drops an empty room after its TTL", async () => {
    const { hub, clock } = setup({ roomTtlMs: 1000 });
    const { sock: mac } = await macOnline(hub, []);
    mac.handler.close();
    hub.sweep();
    expect(hub.stats().rooms).toBe(1);
    clock.now += 2000;
    hub.sweep();
    expect(hub.stats().rooms).toBe(0);
  });
});

describe("what the relay sees", () => {
  test("a known plaintext, really encrypted, is in no log line and no queue", async () => {
    const { hub, lines } = setup();
    const phone = await newIdentity();
    const { sock: mac, room } = await macOnline(hub, [phone]);
    const plaintext = "SECRET-PLAINTEXT-approve rm -rf /tmp/never";
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, text(plaintext)));
    const ciphertext = new Uint8Array([...iv, ...sealed]);
    const id = await phone.deviceId();

    // One frame is delivered live, one waits in the queue.
    const dev = await deviceOnline(hub, phone, room);
    dev.send(deviceFrame([1, 2, 3, 4], ciphertext));
    await until(() => mac.binary().length === 1);
    dev.handler.close();
    mac.send(macFrame(id, [1, 2, 3, 4], ciphertext));
    await until(() => hub.heldFrames().length === 1, "queued frame");

    const log = lines.join("\n");
    const dump = hub.heldFrames().map((f) => new TextDecoder("latin1").decode(f)).join("\n");
    const probes = [plaintext, toBase64Url(ciphertext), toBase64Url(sealed), Buffer.from(ciphertext).toString("hex"), Buffer.from(ciphertext).toString("base64")];
    for (const probe of probes) expect(log).not.toContain(probe);
    expect(dump).not.toContain(plaintext);
    // The log holds no key, no signature, no nonce, and no address either.
    expect(log).not.toContain(phone.publicKey);
    expect(log).not.toContain("10.0.0.1");
    expect(log).not.toContain(room);
    expect(log).toContain("connect");
  });
});
