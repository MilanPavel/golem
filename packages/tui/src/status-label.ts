import type { ConnectionState } from "@golem/client";

export type ModelInfo = {
  profile: string | null;
  provider: string | null;
  name: string | null;
};

const emptyModel: ModelInfo = { profile: null, provider: null, name: null };

export function statusLabel(state: ConnectionState): string {
  switch (state.status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "closed";
    case "rejected":
      return state.reason;
  }
}

export function modelChip(name: string | null, profile: string | null): string {
  if (name !== null && name.length > 0 && profile !== null && profile.length > 0) {
    return `${name} · ${profile}`;
  }
  if (name !== null && name.length > 0) {
    return name;
  }
  if (profile !== null && profile.length > 0) {
    return profile;
  }
  return "";
}

export function preferModel(session: ModelInfo | null, daemon: ModelInfo | null): ModelInfo {
  if (session === null) {
    return daemon ?? emptyModel;
  }
  return {
    profile: session.profile ?? daemon?.profile ?? null,
    provider: session.provider ?? daemon?.provider ?? null,
    name: session.name ?? daemon?.name ?? null,
  };
}

export function shortCwd(cwd: string, home: string): string {
  if (home.length === 0) {
    return cwd;
  }
  if (cwd === home) {
    return "~";
  }
  const prefix = home.endsWith("/") ? home : `${home}/`;
  if (cwd.startsWith(prefix)) {
    return `~/${cwd.slice(prefix.length)}`;
  }
  return cwd;
}

export type StatusTone = "connection" | "title" | "model" | "dim";

export type StatusSegment = {
  id: string;
  text: string;
  /** Lower numbers leave the line first. Gaps are reserved for later segments. */
  priority: number;
  tone: StatusTone;
  /** Stays on a narrow terminal. Shortened only when it is the last segment left. */
  keep?: boolean;
};

/**
 * Connection never drops. After that, the right-hand segments leave first:
 * uptime, message count, folder, then model, then the title.
 */
export const STATUS_PRIORITY = {
  connection: 100,
  title: 80,
  model: 60,
  folder: 40,
  messages: 20,
  uptime: 10,
} as const;

const SEGMENT_GAP = 2;

export function versionLabel(
  tuiVersion: string,
  daemonVersion: string,
): { text: string; warn: boolean } {
  if (daemonVersion.length === 0 || tuiVersion === daemonVersion) {
    return { text: tuiVersion, warn: false };
  }
  return { text: `tui ${tuiVersion} · daemon ${daemonVersion}`, warn: true };
}

export function sessionTitleLabel(title: string | null | undefined): string {
  if (title === undefined || title === null || title.trim().length === 0) {
    return "untitled";
  }
  return title;
}

/** `session.updated` wins for the session it names. The list covers a switch before replay. */
export function shownSessionTitle(
  sessionId: string | null,
  live: { sessionId: string; title: string } | null,
  indexed: string | null | undefined,
): string {
  if (sessionId === null) {
    return sessionTitleLabel(null);
  }
  if (live !== null && live.sessionId === sessionId) {
    return sessionTitleLabel(live.title);
  }
  return sessionTitleLabel(indexed);
}

export function formatMessageCount(count: number): string {
  const messages = Math.max(0, Math.floor(count));
  return messages === 1 ? "1 msg" : `${messages} msgs`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  if (days > 0) {
    return hours > 0 ? `up ${days}d ${hours}h` : `up ${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `up ${hours}h ${minutes}m` : `up ${hours}h`;
  }
  if (minutes > 0) {
    return `up ${minutes}m`;
  }
  return `up ${secs}s`;
}

/** Seconds refresh every second. A coarser unit can wait a minute. */
export function uptimeRefreshMs(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds)) {
    return null;
  }
  return seconds < 60 ? 1_000 : 60_000;
}

/** Wall-clock instant the daemon process started, from one `daemon.status` sample. */
export function startedAtMs(nowMs: number, uptimeSeconds: number): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    return null;
  }
  return nowMs - uptimeSeconds * 1000;
}

export function statusSegments(input: {
  connection: string;
  title: string;
  model: string;
  folder: string;
  messageCount: number | null;
  uptimeSeconds: number | null;
}): StatusSegment[] {
  return [
    segment("connection", input.connection, STATUS_PRIORITY.connection, "connection", true),
    segment("title", input.title, STATUS_PRIORITY.title, "title"),
    segment("model", input.model, STATUS_PRIORITY.model, "model"),
    segment("folder", input.folder, STATUS_PRIORITY.folder, "dim"),
    segment(
      "messages",
      input.messageCount === null ? "" : formatMessageCount(input.messageCount),
      STATUS_PRIORITY.messages,
      "dim",
    ),
    segment(
      "uptime",
      input.uptimeSeconds === null ? "" : formatUptime(input.uptimeSeconds),
      STATUS_PRIORITY.uptime,
      "dim",
    ),
  ];
}

/** Drop the lowest-priority segment until the line fits. The connection segment is kept. */
export function fitSegments(segments: readonly StatusSegment[], columns: number): StatusSegment[] {
  if (columns <= 0) {
    return [];
  }
  let kept = segments.filter((part) => part.text.length > 0);
  while (segmentWidth(kept) > columns) {
    const drop = lowestDroppable(kept);
    if (drop === undefined) {
      return truncateLast(kept, columns);
    }
    if (drop.id === "title") {
      const shrunk = shrinkTitle(kept, drop, columns);
      if (shrunk !== null) {
        return shrunk;
      }
    }
    kept = kept.filter((part) => part !== drop);
  }
  return kept;
}

function segment(
  id: string,
  text: string,
  priority: number,
  tone: StatusTone,
  keep = false,
): StatusSegment {
  return { id, text, priority, tone, keep };
}

function lowestDroppable(segments: readonly StatusSegment[]): StatusSegment | undefined {
  let found: StatusSegment | undefined;
  for (const part of segments) {
    if (part.keep === true) {
      continue;
    }
    if (found === undefined || part.priority <= found.priority) {
      found = part;
    }
  }
  return found;
}

/** The title stays, shortened, until there is no room left beside the connection. */
function shrinkTitle(
  segments: readonly StatusSegment[],
  title: StatusSegment,
  columns: number,
): StatusSegment[] | null {
  const others = segments.filter((part) => part !== title);
  const room = columns - segmentWidth(others) - (others.length > 0 ? SEGMENT_GAP : 0);
  const text = shrinkTo(title.text, room);
  if (text === null) {
    return null;
  }
  return segments.map((part) => (part === title ? { ...part, text } : part));
}

function shrinkTo(text: string, room: number): string | null {
  if (room <= 0) {
    return null;
  }
  if (text.length <= room) {
    return text;
  }
  if (room === 1) {
    return text.slice(0, 1);
  }
  return `${text.slice(0, room - 1)}\u2026`;
}

function truncateLast(segments: readonly StatusSegment[], columns: number): StatusSegment[] {
  const last = segments[segments.length - 1];
  if (last === undefined) {
    return [];
  }
  const others = segments.slice(0, -1);
  const room = columns - segmentWidth(others) - (others.length > 0 ? SEGMENT_GAP : 0);
  return [...others, { ...last, text: last.text.slice(0, Math.max(0, room)) }];
}

function segmentWidth(segments: readonly StatusSegment[]): number {
  if (segments.length === 0) {
    return 0;
  }
  const text = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  return text + SEGMENT_GAP * (segments.length - 1);
}
