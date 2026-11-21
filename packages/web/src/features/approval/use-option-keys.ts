import { approvalAnswerForKey, type ApprovalAnswerOption } from "@golem/view";
import { useEffect, useRef } from "react";
import { keyBelongsElsewhere } from "./use-approval-keys.ts";

/**
 * Answers a helper's question from the keyboard with the keys of its options (Enter, H, T, D). Keys that belong
 * to something else are left alone, as for the lead's own approval. No options, no keys.
 */
export function useOptionKeys({
  options,
  canAnswer,
  onChoose,
}: {
  options: readonly ApprovalAnswerOption[];
  canAnswer: () => boolean;
  onChoose: (option: ApprovalAnswerOption) => void;
}): void {
  const latest = useRef({ options, canAnswer, onChoose });
  useEffect(() => {
    latest.current = { options, canAnswer, onChoose };
  });
  const active = options.length > 0;

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (keyBelongsElsewhere(event)) return;
      const option = approvalAnswerForKey(latest.current.options, event.key);
      if (option === null || !latest.current.canAnswer()) return;
      event.preventDefault();
      latest.current.onChoose(option);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}
