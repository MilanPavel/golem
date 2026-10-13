export const WIRE_LIMIT = 50;

export type WireDirection = "out" | "in" | "both";

const DETAIL_LIMIT = 500;
const JSON_LIMIT = 2_000;

export type WireFrame = {
  direction: "out" | "in";
  kind: string;
  chars?: number;
  detail?: string;
  json?: string;
};

export type WireLine = {
  direction: WireDirection;
  kind: string;
  count: number;
  chars: number;
  detail: string;
  json: string;
};

export function pushWire(
  lines: readonly WireLine[],
  frame: WireFrame,
  limit = WIRE_LIMIT,
): WireLine[] {
  const chars = frame.chars ?? 0;
  const detail = clipDetail(frame.detail);
  const json = clipJson(frame.json);
  const last = lines.at(-1);
  if (last !== undefined && last.kind === frame.kind && collapses(last, frame)) {
    const direction = frame.kind === "ping" ? mergeDirection(last.direction, frame.direction) : last.direction;
    const next = lines.slice(0, -1);
    next.push({
      direction,
      kind: last.kind,
      count: last.count + 1,
      chars: last.chars + chars,
      detail: frame.kind === "message.delta" ? joinDetail(last.detail, detail) : last.detail,
      json: frame.kind === "message.delta" && json.length > 0 ? json : last.json,
    });
    return next;
  }
  const appended = [
    ...lines,
    { direction: frame.direction, kind: frame.kind, count: 1, chars, detail, json },
  ];
  if (appended.length <= limit) {
    return appended;
  }
  return appended.slice(appended.length - limit);
}

export function formatWireLine(line: WireLine): string {
  const prefix = arrow(line.direction);
  if (line.json.length > 0) {
    const times = line.count > 1 ? `×${line.count} ` : "";
    return `${prefix}${times}${line.json}`;
  }
  const times = line.count > 1 && (line.kind === "message.delta" || line.kind === "ping") ? ` ×${line.count}` : "";
  const head = `${prefix}${line.kind}${times}`;
  if (line.detail.length > 0) {
    return `${head}  ${line.detail}`;
  }
  if (line.kind === "message.delta") {
    return `${head}, ${line.chars} chars`;
  }
  return head;
}

export function pingTotal(lines: readonly WireLine[]): number {
  return lines.reduce((sum, line) => (line.kind === "ping" ? sum + line.count : sum), 0);
}

function collapses(last: WireLine, frame: WireFrame): boolean {
  if (frame.kind === "ping") {
    return true;
  }
  return frame.kind === "message.delta" && last.direction === frame.direction;
}

function mergeDirection(current: WireDirection, next: "out" | "in"): WireDirection {
  if (current === "both" || current !== next) {
    return "both";
  }
  return current;
}

function clipJson(json: string | undefined): string {
  if (json === undefined || json.length === 0) {
    return "";
  }
  return json.length <= JSON_LIMIT ? json : json.slice(0, JSON_LIMIT);
}

function clipDetail(detail: string | undefined): string {
  if (detail === undefined || detail.length === 0) {
    return "";
  }
  return detail.length <= DETAIL_LIMIT ? detail : detail.slice(0, DETAIL_LIMIT);
}

function joinDetail(current: string, next: string): string {
  if (next.length === 0 || current.length >= DETAIL_LIMIT) {
    return current;
  }
  const joined = current + next;
  return joined.length <= DETAIL_LIMIT ? joined : joined.slice(0, DETAIL_LIMIT);
}

function arrow(direction: WireDirection): string {
  if (direction === "out") {
    return "→ ";
  }
  if (direction === "in") {
    return "← ";
  }
  return "";
}
