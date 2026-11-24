import { pullSpeed, timeLeft } from "@golem/view";
import type { PullEntry, PullsSnapshot } from "../../../store/pulls.ts";
import { hfPull, pullShare, shortName } from "../../models/model-text.ts";

/**
 * What the tray remembers between two snapshots of the downloads. The store has no list of finished downloads,
 * so a download that leaves `active` without a failure is kept here as ready.
 */
export type TrayMemory = {
  /** The downloads that were running, with how far they were. */
  seen: ReadonlyMap<string, number | null>;
  /** The downloads that finished, oldest first, until the person dismisses them. */
  ready: readonly string[];
  /** The failures the person dismissed, with the words they had. A new failure shows again. */
  dismissed: ReadonlyMap<string, string>;
  /** The downloads the person stopped here, until the stop has taken effect. A stop ends like a finish and must not read as ready. */
  stopped: ReadonlySet<string>;
};

export const EMPTY_TRAY: TrayMemory = { seen: new Map(), ready: [], dismissed: new Map(), stopped: new Set() };

/** A download counts as finished when it was nearly there, or the listing already has it. A stop or a lost link is neither. */
const NEARLY = 0.95;

function same(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

/**
 * The memory after a new snapshot. It returns the same object when nothing changed, so a render can compare it.
 * `installed` holds the refs the listing has installed. A stopped ref is forgotten once it has left `active`,
 * so a later start of the same ref is judged like any other download.
 */
export function watchTray(memory: TrayMemory, pulls: PullsSnapshot, installed: ReadonlySet<string>): TrayMemory {
  const seen = new Map<string, number | null>();
  for (const [ref, entry] of pulls.active) seen.set(ref, pullShare(entry, null));

  let ready = memory.ready.filter((ref) => !pulls.active.has(ref) && !pulls.failed.has(ref));
  for (const [ref, share] of memory.seen) {
    if (pulls.active.has(ref) || pulls.failed.has(ref) || memory.stopped.has(ref) || ready.includes(ref)) continue;
    if ((share !== null && share >= NEARLY) || installed.has(ref)) ready = [...ready, ref];
  }

  const dismissed = new Map([...memory.dismissed].filter(([ref, words]) => pulls.failed.get(ref) === words));

  const stopped = new Set([...memory.stopped].filter((ref) => pulls.active.has(ref)));

  if (same(seen, memory.seen) && same(dismissed, memory.dismissed) && stopped.size === memory.stopped.size && [...stopped].every((ref) => memory.stopped.has(ref)) && ready.length === memory.ready.length && ready.every((ref, index) => ref === memory.ready[index])) {
    return memory;
  }
  return { seen, ready, dismissed, stopped };
}

/** The person stopped this download here: its end is not a finish. */
export function stopTray(memory: TrayMemory, ref: string): TrayMemory {
  return { ...memory, stopped: new Set(memory.stopped).add(ref) };
}

/** The ready row goes. */
export function dismissReady(memory: TrayMemory, ref: string): TrayMemory {
  return { ...memory, ready: memory.ready.filter((item) => item !== ref) };
}

/** The failed row goes, until the same download fails again with other words. */
export function dismissFailed(memory: TrayMemory, ref: string, words: string): TrayMemory {
  return { ...memory, dismissed: new Map(memory.dismissed).set(ref, words) };
}

export type TrayRow =
  | { kind: "running"; ref: string; name: string; hf: boolean; share: number | null; text: string }
  | { kind: "ready"; ref: string; name: string; hf: boolean }
  | { kind: "failed"; ref: string; name: string; hf: boolean; words: string; detail: string | null; leftoverGb: number | null };

/** `qwen3:8b`, or `user/repo:Q4_K_M` for a Hugging Face one. */
export function trayName(ref: string): string {
  const hf = hfPull(ref);
  return hf === null ? shortName(ref) : `${hf.repo}:${hf.quant}`;
}

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

/** `16.2 GB of this download is still on disk.` */
export function leftoverText(leftoverGb: number): string {
  return `${leftoverGb.toFixed(1)} GB of this download is still on disk.`;
}

/** `34% · 5.5 of 16.2 GB · 3 min left`, with what is known so far. */
export function trayText(entry: PullEntry): string {
  const { track } = entry;
  const share = pullShare(entry, null);
  const parts: string[] = [];
  if (share !== null) parts.push(`${Math.floor(share * 100)}%`);
  if (track.total !== null && track.total > 0) parts.push(`${gb(track.completed)} of ${gb(track.total)} GB`);
  else if (track.completed > 0) parts.push(`${gb(track.completed)} GB`);
  const speed = pullSpeed(track);
  if (speed !== null && track.total !== null && track.total > track.completed) {
    parts.push(`${timeLeft((track.total - track.completed) / speed)} left`);
  }
  return parts.length > 0 ? parts.join(" · ") : "starting…";
}

/** The rows of the tray: running first, then ready, then failed. A stop is not a failure. */
export function trayRows(memory: TrayMemory, pulls: PullsSnapshot): TrayRow[] {
  const rows: TrayRow[] = [];
  const base = (ref: string) => ({ ref, name: trayName(ref), hf: hfPull(ref) !== null });
  for (const [ref, entry] of pulls.active) rows.push({ kind: "running", ...base(ref), share: pullShare(entry, null), text: trayText(entry) });
  for (const ref of memory.ready) rows.push({ kind: "ready", ...base(ref) });
  for (const [ref, words] of pulls.failed) {
    if (words === "cancelled" || pulls.active.has(ref) || memory.dismissed.get(ref) === words) continue;
    const more = pulls.extra?.get(ref);
    rows.push({ kind: "failed", ...base(ref), words, detail: more?.detail ?? null, leftoverGb: more?.leftoverGb ?? null });
  }
  return rows;
}

/** What the status region says. It changes when a download starts, ends or fails, never with a percent. */
export function trayStatus(rows: readonly TrayRow[]): string {
  const running = rows.filter((row) => row.kind === "running").map((row) => row.name);
  const ready = rows.filter((row) => row.kind === "ready").map((row) => row.name);
  const failed = rows.flatMap((row) => (row.kind === "failed" ? [`Download of ${row.name} failed: ${row.words}`] : []));
  return [
    running.length === 0 ? null : `Downloading ${running.join(", ")}.`,
    ready.length === 0 ? null : `${ready.join(", ")} ${ready.length === 1 ? "is" : "are"} ready.`,
    ...failed,
  ]
    .filter((part) => part !== null)
    .join(" ");
}
