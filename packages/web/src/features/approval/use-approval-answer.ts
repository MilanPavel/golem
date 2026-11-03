import type { ApprovalChoice } from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendErrorText } from "../../store/errors.ts";

type Sent = { id: string; error: string | null };

/**
 * Sends an answer, one at a time. `sendingId` is the call being answered, and stays set once the
 * answer is sent, until the daemon's `approval.resolved` moves the card on. A failure ends the
 * sending and sets `error`. `callId` is the call now pending: the sending mark and the error
 * belong to the call they came from, so a new call starts clean.
 */
export function useApprovalAnswer(
  respond: (callId: string, decision: ApprovalChoice) => Promise<void>,
  callId: string | null = null,
): { answer: (callId: string, decision: ApprovalChoice) => void; sendingId: string | null; error: string | null } {
  const [sent, setSent] = useState<Sent | null>(null);
  const [failed, setFailed] = useState<Sent | null>(null);
  const flying = useRef<string | null>(null);
  const latest = useRef(respond);
  useEffect(() => {
    latest.current = respond;
  });

  const answer = useCallback((id: string, decision: ApprovalChoice) => {
    if (flying.current === id) return;
    flying.current = id;
    setSent({ id, error: null });
    setFailed(null);
    latest.current(id, decision).catch((err: unknown) => {
      flying.current = null;
      setSent(null);
      setFailed({ id, error: sendErrorText(err) });
    });
  }, []);

  return {
    answer,
    sendingId: sent !== null && sent.id === callId ? sent.id : null,
    error: failed !== null && failed.id === callId ? failed.error : null,
  };
}
