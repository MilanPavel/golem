import type { DeviceInfo, DeviceListResult, DevicePairChanged, DeviceRevokeResult, DeviceRule, GolemClient, PairingDevice } from "@golem/client";
import type { QueryClient } from "@tanstack/react-query";
import { actionErrorText } from "./errors.ts";
import { createStore, type StoreSource } from "./create-store.ts";

export type { DeviceInfo, DeviceListResult, DeviceRevokeResult, DeviceRule, PairingDevice };

/** The query key of `device.list`. A pushed `device.changed` and every action below mark it stale. */
export const DEVICE_LIST_KEY = ["device.list"] as const;

export type PairingClient = Pick<GolemClient, "devicePairBegin" | "devicePairConfirm" | "onDevicePairChanged">;

/** Where the pairing of a phone stands, as the Devices tab shows it. */
export type PairingSnapshot =
  | { phase: "idle" }
  | { phase: "starting" }
  /** The code is up. `uri` is the `golem://pair` link; `expiresAt` is in unix seconds. */
  | { phase: "waiting"; pair: string; uri: string; expiresAt: number }
  /** The phone showed the right code. The owner compares `words` with its screen. */
  | { phase: "words"; pair: string; words: readonly string[]; device: PairingDevice | null; busy: boolean; error: string | null }
  | { phase: "paired"; device: PairingDevice | null }
  | { phase: "ended"; reason: "expired" | "refused" }
  /** The pairing could not start (no relay is set), or an answer failed. */
  | { phase: "failed"; message: string };

export type Pairing = StoreSource<PairingSnapshot> & {
  /** Open a pairing: the code arrives in the snapshot. */
  begin(): Promise<void>;
  /** The owner compared the words: pair the phone (`true`) or refuse it. */
  confirm(accept: boolean): Promise<void>;
  /** Give up the open pairing, if any, and go back to idle. */
  cancel(): void;
  /** Go back to idle after a result was read. */
  dismiss(): void;
  start(): void;
  stop(): void;
};

const IDLE: PairingSnapshot = { phase: "idle" };

/**
 * The one pairing this page opened. Notifications for another pairing (the terminal's) are not
 * shown. The words come only with the notification and are held in memory, never logged.
 */
export function createPairing(client: PairingClient, queryClient: QueryClient): Pairing {
  const store = createStore<PairingSnapshot>(IDLE);
  let pair: string | null = null;
  let off: (() => void) | undefined;

  function changed(change: DevicePairChanged): void {
    if (pair === null || change.pair !== pair) return;
    const now = store.getSnapshot();
    switch (change.state) {
      case "words":
        store.set({ phase: "words", pair: change.pair, words: change.words ?? [], device: change.device ?? null, busy: false, error: null });
        break;
      case "paired":
        pair = null;
        store.set({ phase: "paired", device: change.device ?? (now.phase === "words" ? now.device : null) });
        void queryClient.invalidateQueries({ queryKey: DEVICE_LIST_KEY });
        break;
      case "expired":
      case "refused":
        pair = null;
        store.set({ phase: "ended", reason: change.state });
        break;
      case "waiting":
        break;
    }
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async begin() {
      store.set({ phase: "starting" });
      try {
        const begun = await client.devicePairBegin();
        pair = begun.pair;
        store.set({ phase: "waiting", pair: begun.pair, uri: begun.uri, expiresAt: begun.expires_at });
      } catch (error) {
        pair = null;
        store.set({ phase: "failed", message: actionErrorText(error, "Could not start the pairing.") });
      }
    },
    async confirm(accept) {
      const now = store.getSnapshot();
      if (now.phase !== "words" || now.busy) return;
      store.set({ ...now, busy: true, error: null });
      try {
        const done = await client.devicePairConfirm(now.pair, accept);
        if (!accept) {
          pair = null;
          store.set(IDLE);
          return;
        }
        // The `paired` notification may have come first; this is the same answer.
        if (store.getSnapshot().phase !== "paired") {
          pair = null;
          store.set({ phase: "paired", device: done.device === null || done.device === undefined ? now.device : { id: done.device.id, name: done.device.name, model: now.device?.model ?? "" } });
        }
        void queryClient.invalidateQueries({ queryKey: DEVICE_LIST_KEY });
      } catch (error) {
        const after = store.getSnapshot();
        // A notification that ended the pairing while the call was out is the better answer.
        if (after.phase === "words") store.set({ ...after, busy: false, error: actionErrorText(error, "Could not answer the pairing.") });
      }
    },
    cancel() {
      const open = pair;
      pair = null;
      store.set(IDLE);
      if (open !== null) void client.devicePairConfirm(open, false).catch(() => undefined);
    },
    dismiss() {
      pair = null;
      store.set(IDLE);
    },
    start() {
      off ??= client.onDevicePairChanged(changed);
    },
    stop() {
      off?.();
      off = undefined;
    },
  };
}

/** `2026-11-21T10:00:00+01:00` as `21 Nov`. Anything that is not a date is shown as it is. */
export function shortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** How long ago `iso` was, in the words of the list: "just now", "2 min ago", "3 h ago", "5 days ago". */
export function ago(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
