// `golem devices pair|list|rename|revoke`: the phones paired with this Mac (ADR-051).

import type { DeviceInfo, DevicePairChanged, GolemClient } from "@golem/client";
import { encodeQr, qrToTerminal } from "@golem/view";

export const DEVICES_USAGE =
  "usage: golem devices [list] | golem devices pair [--link] | golem devices rename <phone> <name> | golem devices revoke <phone> [--yes]";

export type DevicesArgs =
  | { kind: "list" }
  | { kind: "pair"; link: boolean }
  | { kind: "rename"; device: string; name: string }
  | { kind: "revoke"; device: string; yes: boolean }
  | { kind: "error"; message: string };

/** Parse what follows `golem devices`. */
export function parseDevicesArgs(args: readonly string[]): DevicesArgs {
  const [sub, ...rest] = args;
  const bad: DevicesArgs = { kind: "error", message: DEVICES_USAGE };
  switch (sub) {
    case undefined:
    case "list":
      return rest.length === 0 ? { kind: "list" } : bad;
    case "pair": {
      if (rest.length === 0) return { kind: "pair", link: false };
      return rest.length === 1 && rest[0] === "--link" ? { kind: "pair", link: true } : bad;
    }
    case "rename": {
      const [device, ...name] = rest;
      if (device === undefined || device.startsWith("-") || name.length === 0 || name.some((n) => n.startsWith("-"))) return bad;
      return { kind: "rename", device, name: name.join(" ") };
    }
    case "revoke": {
      const yes = rest.includes("--yes");
      const rest2 = rest.filter((a) => a !== "--yes");
      const device = rest2[0];
      if (rest2.length !== 1 || device === undefined || device.startsWith("-")) return bad;
      return { kind: "revoke", device, yes };
    }
    default:
      return bad;
  }
}

/** What the commands need from the terminal and the clock. */
export interface DevicesDeps {
  write(line: string): void;
  error(line: string): void;
  /** Whether stdout is a terminal. A QR code is drawn only for one. */
  tty: boolean;
  /** Ask one line. Resolves null when `signal` aborts or the input ends. */
  ask(question: string, signal?: AbortSignal): Promise<string | null>;
  /** Call `handler` on Ctrl-C. Returns a function that stops listening. */
  onInterrupt(handler: () => void): () => void;
  now(): Date;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PAIRED = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** `2026-11-21T10:00:00+01:00` as `2026-11-21 10:00`. Anything else is shown as it is. */
export function shortTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "never";
  const m = PAIRED.exec(iso);
  return m === null ? iso : `${m[1]} ${m[2]}`;
}

/** The phones as a table, active ones first, revoked ones marked. */
export function formatDevices(devices: readonly DeviceInfo[]): string {
  if (devices.length === 0) return "No phones are paired. Pair one with: golem devices pair";
  const rows = devices.map((d) => [
    d.name,
    d.id.slice(0, 8),
    d.revoked_at != null ? `revoked ${shortTime(d.revoked_at)}` : `paired ${shortTime(d.paired_at)}`,
    d.revoked_at != null ? "" : `seen ${shortTime(d.last_seen)}`,
    (d.rules ?? 0) > 0 ? `${d.rules} rule${d.rules === 1 ? "" : "s"}` : "",
  ]);
  const widths = [0, 1, 2, 3, 4].map((i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd()).join("\n");
}

/** The phone named by an id (or the start of one) or by its name. Throws a sentence when none or several fit. */
export function findDevice(devices: readonly DeviceInfo[], given: string): DeviceInfo {
  const active = devices.filter((d) => d.revoked_at == null);
  const wanted = given.toLowerCase();
  const exact = active.filter((d) => d.name.toLowerCase() === wanted || d.id === wanted);
  const found = exact.length > 0 ? exact : active.filter((d) => wanted.length >= 4 && d.id.startsWith(wanted));
  if (found.length === 1 && found[0] !== undefined) return found[0];
  if (found.length > 1) throw new Error(`"${given}" fits ${found.length} phones. Use the id from golem devices list.`);
  throw new Error(`no paired phone is called "${given}". See golem devices list.`);
}

export async function runDevicesList(client: GolemClient, deps: DevicesDeps): Promise<number> {
  deps.write(formatDevices((await client.deviceList()).devices));
  return 0;
}

export async function runDevicesRename(client: GolemClient, args: { device: string; name: string }, deps: DevicesDeps): Promise<number> {
  const found = findDevice((await client.deviceList()).devices, args.device);
  const done = await client.deviceRename(found.id, args.name);
  deps.write(`${found.name} is now called ${done.device.name}.`);
  return 0;
}

/** Revoke asks once. The phone is cut off at once; the "Always allow" rules it made stay, and are listed. */
export async function runDevicesRevoke(client: GolemClient, args: { device: string; yes: boolean }, deps: DevicesDeps): Promise<number> {
  const found = findDevice((await client.deviceList()).devices, args.device);
  if (!args.yes) {
    const rules = found.rules ?? 0;
    const note = rules > 0 ? ` Its ${rules} "Always allow" rule${rules === 1 ? "" : "s"} stay.` : "";
    const answer = await deps.ask(`Revoke ${found.name}? It is cut off at once and must be paired again.${note} [y/N] `);
    if (answer === null || !/^y(es)?$/i.test(answer.trim())) {
      deps.write("Nothing changed.");
      return 1;
    }
  }
  const done = await client.deviceRevoke(found.id);
  deps.write(done.revoked ? `Revoked ${done.device.name}. Its link is closed.` : `${done.device.name} was already revoked.`);
  if (done.rules.length > 0) {
    deps.write(`It made ${done.rules.length} "Always allow" rule${done.rules.length === 1 ? "" : "s"}. They stay, marked "from a revoked device" in Tool rules:`);
    for (const r of done.rules) deps.write(`  ${r.rule}  (${shortTime(r.at)})`);
  }
  return 0;
}

const CONFIRM_QUESTION = "Confirm only if your phone shows the same words. Pair it? [y/N] ";
const ABORTED = { aborted: true } as const;
const isAborted = (value: unknown): value is typeof ABORTED => value === ABORTED;
/** The owner has 2 minutes to compare the words (ADR-051). The daemon ends it; this is the fallback. */
const CONFIRM_WAIT_MS = 130_000;

/** The pairing's notifications, one at a time. A wait ends on a change, on the time, or on an abort, and leaves no timer behind. */
function changeQueue(client: GolemClient, pairOf: () => string) {
  const queue: DevicePairChanged[] = [];
  let wake: () => void = () => undefined;
  const stop = client.onDevicePairChanged((change) => {
    if (change.pair !== pairOf()) return;
    queue.push(change);
    wake();
  });
  return {
    stop,
    next(ms: number, signal: AbortSignal): Promise<DevicePairChanged | null | typeof ABORTED> {
      return new Promise((resolve) => {
        const timer = setTimeout(() => done(null), ms);
        const done = (value: DevicePairChanged | null | typeof ABORTED): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          wake = () => undefined;
          resolve(value);
        };
        const onAbort = (): void => done(ABORTED);
        const take = (): void => {
          const change = queue.shift();
          if (change !== undefined) done(change);
        };
        if (signal.aborted) return done(ABORTED);
        if (queue.length > 0) return take();
        signal.addEventListener("abort", onAbort);
        wake = take;
      });
    },
  };
}

/**
 * `golem devices pair`: show the QR code, wait for the phone, show the three words, and ask. Returns 0 when the phone
 * is paired. A code works once and ends in 5 minutes; Ctrl-C cancels the pairing.
 */
export async function runDevicesPair(client: GolemClient, args: { link: boolean }, deps: DevicesDeps): Promise<number> {
  let pair = "";
  const changes = changeQueue(client, () => pair);
  const interrupt = new AbortController();
  const unhook = deps.onInterrupt(() => interrupt.abort());
  try {
    const begun = await client.devicePairBegin();
    pair = begun.pair;
    const left = Math.max(0, begun.expires_at - Math.floor(deps.now().getTime() / 1000));
    if (deps.tty) {
      deps.write(`Scan this code with your iPhone. It works once and ends in ${Math.max(1, Math.round(left / 60))} minutes.`);
      deps.write(qrToTerminal(encodeQr(begun.uri)));
      if (args.link) deps.write(begun.uri);
    } else {
      // Not a terminal: print the link alone, for a script.
      deps.write(begun.uri);
    }
    deps.write("waiting for the phone…");
    for (;;) {
      const change = await changes.next((left + 150) * 1000, interrupt.signal);
      if (isAborted(change)) {
        await client.devicePairConfirm(pair, false).catch(() => undefined);
        deps.error("Pairing cancelled.");
        return 130;
      }
      if (change === null) {
        deps.error("No phone came. Run golem devices pair again for a new code.");
        return 1;
      }
      if (change.state === "expired") {
        deps.error("The code ended. Run golem devices pair again for a new code.");
        return 1;
      }
      if (change.state === "refused") {
        deps.error("The pairing was cancelled. Run golem devices pair again for a new code.");
        return 1;
      }
      if (change.state === "paired") {
        deps.write(`Paired: ${change.device?.name ?? "the phone"}.`);
        return 0;
      }
      if (change.state !== "words") continue;
      return await confirmWords(client, pair, change, changes, interrupt, deps);
    }
  } finally {
    changes.stop();
    unhook();
  }
}

/** The phone showed the right code. Show its words and ask. The web page may answer first. */
async function confirmWords(
  client: GolemClient,
  pair: string,
  words: DevicePairChanged,
  changes: ReturnType<typeof changeQueue>,
  interrupt: AbortController,
  deps: DevicesDeps,
): Promise<number> {
  const who = words.device == null ? "A phone" : `${words.device.name}${words.device.model ? ` (${words.device.model})` : ""}`;
  deps.write(`${who} wants to pair.`);
  deps.write(`  ${(words.words ?? []).join(" \u00b7 ")}`);
  const prompt = new AbortController();
  const typed = deps.ask(CONFIRM_QUESTION, AbortSignal.any([prompt.signal, interrupt.signal]));
  const elsewhere = (async (): Promise<DevicePairChanged | null | typeof ABORTED> => {
    for (;;) {
      const more = await changes.next(CONFIRM_WAIT_MS, prompt.signal);
      if (isAborted(more) || more === null || more.state !== "words") return more;
    }
  })();
  const first = await Promise.race([typed.then((text) => ({ text })), elsewhere.then((over) => ({ over }))]);
  prompt.abort(); // ends the other wait, and the question if it is still open
  if ("over" in first) {
    const over = first.over;
    if (!isAborted(over) && over !== null && over.state === "paired") {
      deps.write(`Paired: ${over.device?.name ?? "the phone"}.`);
      return 0;
    }
    deps.error("The pairing ended before you answered. Run golem devices pair again.");
    return 1;
  }
  const yes = first.text !== null && /^y(es)?$/i.test(first.text.trim());
  try {
    const done = await client.devicePairConfirm(pair, yes);
    if (!yes) {
      deps.write("Not paired.");
      return 1;
    }
    deps.write(`Paired: ${done.device?.name ?? "the phone"}.`);
    return 0;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}
