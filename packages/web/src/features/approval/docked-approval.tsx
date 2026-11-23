import { helperCardOf, isUseHelpersQuestion, type ApprovalChoice, type ToolBlock } from "@golem/view";
import { useCallback, useState } from "react";
import { useDraftReader, usePageActions, useSession } from "../../store/page-context.tsx";
import { approvalCardId } from "../../store/inbox.ts";
import { ApprovalBar } from "./approval-bar.tsx";
import { HelperBatchCard } from "./helper-batch-card.tsx";
import { useApprovalAnswer } from "./use-approval-answer.ts";
import { useApprovalKeys } from "./use-approval-keys.ts";

type Args = Readonly<Record<string, unknown>>;

/** The call a session waits on, found among its messages, or null when none waits. */
function useWaitingTool(sessionId: string): ToolBlock | null {
  return useSession(sessionId, ({ chat }) => {
    const callId = chat.approval?.callId;
    if (callId === undefined) return null;
    for (const message of chat.messages) {
      const tool = message.tools?.find((item) => item.callId === callId);
      if (tool?.approval !== undefined) return tool;
    }
    return null;
  });
}

/**
 * The approval of a session, docked above its composer, with the keys that answer it: Enter, S, W, D,
 * and E to edit. A key answers only while the composer is empty and the arguments are not being edited.
 * When the setting "Use helpers" asks (source `use_helpers`), the batch card shows instead: Enter runs the helpers,
 * "Do it in the chat" declines, and the other keys do nothing. The answer goes through `helpers.respond`.
 */
export function DockedApproval({ sessionId }: { sessionId: string }) {
  const tool = useWaitingTool(sessionId);
  const { respond, respondHelpers } = usePageActions();
  const callId = tool?.callId ?? null;
  const batch = tool !== null && isUseHelpersQuestion({ name: tool.name, source: tool.approval?.source });
  const send = useCallback(
    (call: string, decision: ApprovalChoice, args?: Args) =>
      batch
        ? respondHelpers(sessionId, call, decision !== "deny")
        : args === undefined
          ? respond(sessionId, call, decision)
          : respond(sessionId, call, decision, args),
    [batch, respond, respondHelpers, sessionId],
  );
  const { answer, sendingId, error } = useApprovalAnswer(send, callId);
  // The editor belongs to the call it was opened on; a new pending call starts closed.
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const editing = callId !== null && editingFor === callId;
  const onEdit = useCallback(
    (open: boolean) => {
      setEditingFor(open ? callId : null);
    },
    [callId],
  );
  const readDraft = useDraftReader(sessionId);
  useApprovalKeys({
    callId,
    canAnswer: () => readDraft() === "" && !editing,
    onAnswer: (call, decision) => {
      // The batch card has one key: Enter runs.
      if (!batch || decision === "allow") answer(call, decision);
    },
    onEdit: () => {
      if (!batch) onEdit(true);
    },
  });
  if (tool === null || callId === null) return null;
  if (batch) {
    return (
      <HelperBatchCard
        key={callId}
        model={helperCardOf({ args: tool.args })}
        id={approvalCardId(callId)}
        sending={sendingId === callId}
        error={error}
        onAnswer={(run) => {
          answer(callId, run ? "allow" : "deny");
        }}
      />
    );
  }
  return (
    <ApprovalBar
      key={callId}
      tool={tool}
      id={approvalCardId(callId)}
      sending={sendingId === callId}
      error={error}
      editing={editing}
      onEdit={onEdit}
      onAnswer={(decision, args) => {
        if (args === undefined) answer(callId, decision);
        else answer(callId, decision, args);
      }}
    />
  );
}
