import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeviceInfo, DevicePairChanged, GolemClient } from "@golem/client";

import { findDevice, formatDevices, parseDevicesArgs, runDevicesList, runDevicesPair, runDevicesRename, runDevicesRevoke, type DevicesDeps } from "./devices.ts";

const LINK = "golem://pair?v=1&relay=wss://relay.example.com&mac=AAAA&code=BBBB&exp=1763720300&name=Studio";
const NOW = new Date(1763720000 * 1000);

const phone = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  name: "iPhone 16",
  paired_at: "2026-11-21T10:00:00+01:00",
  last_seen: "2026-11-21T12:30:00+01:00",
  revoked_at: null,
  rules: 0,
  ...over,
});

function setup(options: { tty?: boolean; answers?: (string | null)[]; devices?: DeviceInfo[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const confirms: [string, boolean][] = [];
  const revoked: string[] = [];
  const renamed: [string, string][] = [];
  const listeners = new Set<(c: DevicePairChanged) => void>();
  const interrupts = new Set<() => void>();
  const answers = [...(options.answers ?? [])];
  let devices = options.devices ?? [];
  const client = {
    deviceList: async () => ({ devices }),
    devicePairBegin: async () => ({ pair: "p1", uri: LINK, expires_at: 1763720300 }),
    devicePairConfirm: async (pair: string, accept = true) => {
      confirms.push([pair, accept]);
      return { device: accept ? phone() : null };
    },
    deviceRename: async (device: string, name: string) => {
      renamed.push([device, name]);
      return { device: phone({ name }) };
    },
    deviceRevoke: async (device: string) => {
      revoked.push(device);
      devices = devices.map((d) => (d.id === device ? { ...d, revoked_at: "2026-11-21T13:00:00+01:00" } : d));
      return { device: phone({ revoked_at: "2026-11-21T13:00:00+01:00" }), revoked: true, rules: [{ rule: "shell(git status)", at: "2026-11-21T11:00:00+01:00" }] };
    },
    onDevicePairChanged: (l: (c: DevicePairChanged) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  } as unknown as GolemClient;
  const deps: DevicesDeps = {
    write: (l) => out.push(l),
    error: (l) => err.push(l),
    tty: options.tty ?? true,
    ask: async (q, signal) => {
      asked.push(q);
      const next = answers.shift();
      if (next !== undefined) return next;
      return new Promise<string | null>((resolve) => signal?.addEventListener("abort", () => resolve(null)));
    },
    onInterrupt: (h) => {
      interrupts.add(h);
      return () => void interrupts.delete(h);
    },
    now: () => NOW,
  };
  const emit = (c: Partial<DevicePairChanged> & { state: DevicePairChanged["state"] }) => {
    for (const l of [...listeners]) l({ pair: "p1", ...c } as DevicePairChanged);
  };
  return { client, deps, out, err, asked, confirms, revoked, renamed, emit, interrupt: () => interrupts.forEach((h) => h()), listeners };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const WORDS = { words: ["kiln", "otter", "maple"], device: { id: "a1b2c3d4e5f60718293a4b5c6d7e8f90", name: "iPhone 16", model: "iPhone17,3" } };

test("devices parses its subcommands", () => {
  assert.deepEqual(parseDevicesArgs([]), { kind: "list" });
  assert.deepEqual(parseDevicesArgs(["list"]), { kind: "list" });
  assert.deepEqual(parseDevicesArgs(["pair"]), { kind: "pair", link: false });
  assert.deepEqual(parseDevicesArgs(["pair", "--link"]), { kind: "pair", link: true });
  assert.deepEqual(parseDevicesArgs(["rename", "iPhone", "My", "phone"]), { kind: "rename", device: "iPhone", name: "My phone" });
  assert.deepEqual(parseDevicesArgs(["revoke", "iPhone", "--yes"]), { kind: "revoke", device: "iPhone", yes: true });
  for (const bad of [["pair", "x"], ["rename", "a"], ["revoke"], ["revoke", "a", "b"], ["nope"], ["list", "x"]]) {
    assert.equal(parseDevicesArgs(bad).kind, "error", bad.join(" "));
  }
});

test("list: no phones, one phone, and a revoked phone", async () => {
  assert.equal(formatDevices([]), "No phones are paired. Pair one with: golem devices pair");
  const one = formatDevices([phone({ rules: 2 })]);
  assert.equal(one, "iPhone 16  a1b2c3d4  paired 2026-11-21 10:00  seen 2026-11-21 12:30  2 rules");
  const both = formatDevices([phone(), phone({ id: "b".repeat(32), name: "Old", revoked_at: "2026-11-20T09:00:00+01:00", last_seen: null })]).split("\n");
  assert.match(both[1] ?? "", /^Old\s+bbbbbbbb\s+revoked 2026-11-20 09:00$/);
  const { client, deps, out } = setup({ devices: [phone()] });
  assert.equal(await runDevicesList(client, deps), 0);
  assert.match(out.join("\n"), /iPhone 16/);
});

test("a phone is found by its name, its id, or the start of its id", () => {
  const list = [phone(), phone({ id: "ffff".repeat(8), name: "iPad" })];
  assert.equal(findDevice(list, "ipad").name, "iPad");
  assert.equal(findDevice(list, "a1b2").name, "iPhone 16");
  assert.throws(() => findDevice(list, "nope"), /no paired phone/);
  assert.throws(() => findDevice([phone(), phone({ id: "a1b2".padEnd(32, "0") })], "a1b2"), /fits 2 phones/);
  assert.throws(() => findDevice([phone({ revoked_at: "2026-11-21T13:00:00+01:00" })], "iPhone 16"), /no paired phone/);
});

test("pair draws the QR code and waits, then shows the words and pairs on a yes", async () => {
  const t = setup({ answers: ["y"] });
  const done = runDevicesPair(t.client, { link: false }, t.deps);
  await tick();
  assert.match(t.out[0] ?? "", /Scan this code with your iPhone.*5 minutes/);
  const qr = t.out[1] ?? "";
  assert.ok(qr.includes("▀") && qr.split("\n").length > 20, "a QR code of half blocks");
  assert.ok(!t.out.join("\n").includes(LINK), "the link is not printed without --link");
  t.emit({ state: "waiting" });
  t.emit({ state: "words", ...WORDS });
  assert.equal(await done, 0);
  assert.ok(t.out.includes("iPhone 16 (iPhone17,3) wants to pair."));
  assert.ok(t.out.includes("  kiln · otter · maple"));
  assert.match(t.asked[0] ?? "", /Confirm only if your phone shows the same words/);
  assert.deepEqual(t.confirms, [["p1", true]]);
  assert.ok(t.out.includes("Paired: iPhone 16."));
  assert.equal(t.listeners.size, 0);
});

test("pair: a no refuses the phone", async () => {
  const t = setup({ answers: ["n"] });
  const done = runDevicesPair(t.client, { link: false }, t.deps);
  await tick();
  t.emit({ state: "words", ...WORDS });
  assert.equal(await done, 1);
  assert.deepEqual(t.confirms, [["p1", false]]);
  assert.ok(t.out.includes("Not paired."));
});

test("pair: --link also prints the link, and a pipe gets the link alone", async () => {
  const withLink = setup({ answers: ["n"] });
  const a = runDevicesPair(withLink.client, { link: true }, withLink.deps);
  await tick();
  assert.ok(withLink.out.includes(LINK));
  withLink.emit({ state: "expired" });
  await a;

  const piped = setup({ tty: false });
  const b = runDevicesPair(piped.client, { link: false }, piped.deps);
  await tick();
  assert.equal(piped.out[0], LINK);
  assert.ok(!piped.out.join("\n").includes("▀"));
  piped.emit({ state: "expired" });
  await b;
});

test("pair: an expired code and a cancelled pairing end with a clear line and exit 1", async () => {
  for (const [state, text] of [["expired", /The code ended/], ["refused", /cancelled/]] as const) {
    const t = setup();
    const done = runDevicesPair(t.client, { link: false }, t.deps);
    await tick();
    t.emit({ state });
    assert.equal(await done, 1);
    assert.match(t.err.join("\n"), text);
    assert.deepEqual(t.confirms, []);
  }
});

test("pair: the web page confirms first, and the question is closed", async () => {
  const t = setup(); // no answer typed
  const done = runDevicesPair(t.client, { link: false }, t.deps);
  await tick();
  t.emit({ state: "words", ...WORDS });
  await tick();
  t.emit({ state: "paired", ...WORDS });
  assert.equal(await done, 0);
  assert.deepEqual(t.confirms, []);
  assert.ok(t.out.includes("Paired: iPhone 16."));
});

test("pair: a pairing that ends while the question is open says so", async () => {
  const t = setup();
  const done = runDevicesPair(t.client, { link: false }, t.deps);
  await tick();
  t.emit({ state: "words", ...WORDS });
  await tick();
  t.emit({ state: "expired" });
  assert.equal(await done, 1);
  assert.match(t.err.join("\n"), /ended before you answered/);
});

test("pair: Ctrl-C cancels the pairing", async () => {
  const t = setup();
  const done = runDevicesPair(t.client, { link: false }, t.deps);
  await tick();
  t.interrupt();
  assert.equal(await done, 130);
  assert.deepEqual(t.confirms, [["p1", false]]);
  assert.match(t.err.join("\n"), /Pairing cancelled/);
});

test("pair: a failed begin (no relay set) reaches the caller with the daemon's words", async () => {
  const t = setup();
  (t.client as unknown as { devicePairBegin: () => Promise<never> }).devicePairBegin = async () => {
    throw new Error('no relay is set: add [relay] url = "wss://..." to config.toml (for a local test, run `just relay`)');
  };
  await assert.rejects(runDevicesPair(t.client, { link: false }, t.deps), /just relay/);
  assert.equal(t.listeners.size, 0);
});

test("rename finds the phone and renames it", async () => {
  const t = setup({ devices: [phone()] });
  assert.equal(await runDevicesRename(t.client, { device: "iphone 16", name: "Pocket" }, t.deps), 0);
  assert.deepEqual(t.renamed, [[phone().id, "Pocket"]]);
  assert.deepEqual(t.out, ["iPhone 16 is now called Pocket."]);
});

test("revoke asks once, then lists the rules the phone made", async () => {
  const t = setup({ devices: [phone({ rules: 1 })], answers: ["y"] });
  assert.equal(await runDevicesRevoke(t.client, { device: "iPhone 16", yes: false }, t.deps), 0);
  assert.equal(t.asked.length, 1);
  assert.match(t.asked[0] ?? "", /Revoke iPhone 16\? It is cut off at once.*1 "Always allow" rule stay/);
  assert.deepEqual(t.revoked, [phone().id]);
  assert.ok(t.out.some((l) => l.startsWith("Revoked iPhone 16.")));
  assert.ok(t.out.some((l) => l.includes('"from a revoked device"')));
  assert.ok(t.out.includes("  shell(git status)  (2026-11-21 11:00)"));
});

test("revoke: a no changes nothing, and --yes does not ask", async () => {
  const no = setup({ devices: [phone()], answers: ["n"] });
  assert.equal(await runDevicesRevoke(no.client, { device: "iPhone 16", yes: false }, no.deps), 1);
  assert.deepEqual(no.revoked, []);
  assert.deepEqual(no.out, ["Nothing changed."]);
  const yes = setup({ devices: [phone()] });
  assert.equal(await runDevicesRevoke(yes.client, { device: "iPhone 16", yes: true }, yes.deps), 0);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(yes.revoked, [phone().id]);
});
