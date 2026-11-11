import type { ChatMessage } from "./chat-state.ts";

/** One user message, or the run of assistant steps that answered it. */
export type Turn =
  | { kind: "user"; id: string; message: ChatMessage }
  | { kind: "golem"; id: string; steps: ChatMessage[] };

/**
 * Groups the transcript into turns. Messages carry no run id, so consecutive assistant messages
 * (no user message between them) are one turn: a run with tool calls is one message per model step.
 */
export function groupTurns(messages: readonly ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ kind: "user", id: message.id, message });
      continue;
    }
    const last = turns[turns.length - 1];
    if (last?.kind === "golem") last.steps.push(message);
    else turns.push({ kind: "golem", id: message.id, steps: [message] });
  }
  return turns;
}

/** The footer of a finished turn: the last step's time (counted from the run start) and every step's tools. Null while streaming. */
export function turnFooter(steps: readonly ChatMessage[]): { durationMs: number | undefined; tools: number } | null {
  if (steps.some((step) => step.streaming)) return null;
  const tools = steps.reduce((sum, step) => sum + (step.tools?.length ?? 0), 0);
  return { durationMs: steps[steps.length - 1]?.durationMs, tools };
}
