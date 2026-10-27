import type { ChatMessage } from "./chat-state.ts";

export type MeterPhase = "thinking" | "writing" | "waiting";

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

export function meterPhase(busy: boolean, chars: number, waiting = false): MeterPhase | null {
  if (!busy) {
    return null;
  }
  if (waiting) {
    return "waiting";
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

/** `starting` names a local model server that is starting, such as `ollama`, while nothing is written yet. */
export function meterLine(
  phase: MeterPhase,
  chars: number,
  elapsed: number,
  tick: number,
  columns: number,
  starting: string | null = null,
): string {
  const label =
    phase === "thinking"
      ? starting === null
        ? "thinking"
        : `starting ${starting}`
      : phase === "waiting"
        ? "waiting for your approval"
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
