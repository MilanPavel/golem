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
 * Answers the pending approval from the keyboard: Enter, S, W, D. Keys that belong to
 * something else are left alone: a field, an open overlay, a focused button's own Enter.
 */
export function useApprovalKeys({
  callId,
  canAnswer,
  onAnswer,
}: {
  callId: string | null;
  canAnswer: () => boolean;
  onAnswer: (callId: string, decision: ApprovalChoice) => void;
}): void {
  const latest = useRef({ canAnswer, onAnswer });
  useEffect(() => {
    latest.current = { canAnswer, onAnswer };
  });

  useEffect(() => {
    if (callId === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const decision = keyDecision(event.key);
      if (decision === null) return;
      if (inside(event.target, EDITABLE) || inside(event.target, OVERLAY)) return;
      if (event.key === "Enter" && inside(event.target, INTERACTIVE)) return;
      if (!latest.current.canAnswer()) return;
      event.preventDefault();
      latest.current.onAnswer(callId as string, decision);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [callId]);
}
