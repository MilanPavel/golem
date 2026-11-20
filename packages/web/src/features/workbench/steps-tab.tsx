import { batchCard, batchSteps, isDelegate, type ChatState, type HelperRef } from "@golem/view";
import { useSession } from "../../store/page-context.tsx";
import { useNow } from "../sessions/use-now.ts";
import { StepsView, type StepsBatch } from "./steps-list.tsx";

export { barText, StepsView, type StepsBatch } from "./steps-list.tsx";

/** The helper sessions of each `delegate` call, by the id of the call. */
function refsByCall(chat: Pick<ChatState, "messages">): Map<string, readonly HelperRef[]> {
  const out = new Map<string, readonly HelperRef[]>();
  for (const message of chat.messages) {
    for (const tool of message.tools ?? []) {
      if (isDelegate(tool)) out.set(tool.callId, tool.child?.helpers ?? []);
    }
  }
  return out;
}

/** The batches of a reduced chat, newest first, as lists at `nowMs`. No clock here. */
export function stepsBatches(chat: Pick<ChatState, "messages" | "batches" | "batchTimes">, nowMs: number): StepsBatch[] {
  const refs = refsByCall(chat);
  return Object.values(chat.batches)
    .map((batch) => ({
      callId: batch.callId,
      head: batchCard(batch, "normal").head,
      list: batchSteps(batch, chat.batchTimes[batch.callId] ?? {}, nowMs),
      refs: refs.get(batch.callId) ?? [],
    }))
    .reverse();
}

/** Whether the chat has a batch to show: the Steps tab is there only then. */
export function hasSteps(chat: Pick<ChatState, "batches">): boolean {
  return Object.keys(chat.batches).length > 0;
}

/** The Steps tab: the session's batches of helpers, each a list with a time bar per row, moving once a second. */
export function StepsTab({ sessionId }: { sessionId: string }) {
  const chat = useSession(sessionId, (view) => view.chat);
  const now = useNow(1000);
  return <StepsView batches={stepsBatches(chat, now)} />;
}
