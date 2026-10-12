import type { ChatMessage } from "./chat-state.ts";

export type MeterPhase = "thinking" | "writing";

const BLOCK = 3;

export function assistantChars(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "assistant") {
      return message.text.length;
    }
  }
  return 0;
}

export function meterPhase(busy: boolean, chars: number): MeterPhase | null {
  if (!busy) {
    return null;
  }
  return chars > 0 ? "writing" : "thinking";
}

export function elapsedSeconds(startedAt: string | null, nowMs: number): number {
  if (startedAt === null || startedAt.length === 0) {
    return 0;
  }
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - started) / 1000));
}

export function shuttle(tick: number, width: number): string {
  const track = Math.max(BLOCK, width);
  const span = track - BLOCK;
  if (span === 0) {
    return "█".repeat(BLOCK);
  }
  const period = span * 2;
  const phase = ((tick % period) + period) % period;
  const start = phase <= span ? phase : period - phase;
  return `${"░".repeat(start)}${"█".repeat(BLOCK)}${"░".repeat(track - start - BLOCK)}`;
}

export function meterLine(
  phase: MeterPhase,
  chars: number,
  elapsed: number,
  tick: number,
  columns: number,
): string {
  const label =
    phase === "thinking"
      ? "thinking"
      : `writing · ${chars.toLocaleString("en-US")} chars · ${elapsed}s`;
  if (columns <= 0) {
    return "";
  }
  if (label.length >= columns) {
    return label.slice(0, columns);
  }
  const room = columns - label.length - 2;
  if (room < BLOCK) {
    return label;
  }
  return `${label}  ${shuttle(tick, room)}`;
}
