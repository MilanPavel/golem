import type { ApprovalChoice } from "@golem/view";
import { useEffect, useRef } from "react";
import { keyDecision } from "./text.ts";

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const OVERLAY = "[role=dialog], [role=menu], [role=listbox]";
const INTERACTIVE = "button, a[href], summary, [role=button], [role=switch], [role=tab]";

function inside(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Answers the pending approval from the keyboard: Enter, S, W, D, and opens the editor on E. Keys that belong to
 * something else are left alone: a field, an open overlay, a focused button's own Enter.
 */
export function useApprovalKeys({
  callId,
  canAnswer,
  onAnswer,
  onEdit,
}: {
  callId: string | null;
  canAnswer: () => boolean;
  onAnswer: (callId: string, decision: ApprovalChoice) => void;
  onEdit?: (callId: string) => void;
}): void {
  const latest = useRef({ canAnswer, onAnswer, onEdit });
  useEffect(() => {
    latest.current = { canAnswer, onAnswer, onEdit };
  });

  useEffect(() => {
    if (callId === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const edit = event.key === "e" || event.key === "E";
      const decision = edit ? null : keyDecision(event.key);
      if (decision === null && !edit) return;
      if (inside(event.target, EDITABLE) || inside(event.target, OVERLAY)) return;
      if (event.key === "Enter" && inside(event.target, INTERACTIVE)) return;
      if (!latest.current.canAnswer()) return;
      if (decision === null) {
        if (latest.current.onEdit === undefined) return;
        event.preventDefault();
        latest.current.onEdit(callId as string);
        return;
      }
      event.preventDefault();
      latest.current.onAnswer(callId as string, decision);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [callId]);
}
