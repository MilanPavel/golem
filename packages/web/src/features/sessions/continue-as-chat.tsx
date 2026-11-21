import { useCallback, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { useSessionActions } from "./use-session-actions.ts";

/** What the Continue as chat button needs: the call, whether it is under way, and why the last try failed. */
export type ContinueAction = { onContinue: () => void; busy: boolean; error: string | null };

/**
 * Continue as chat for one helper: forks it into a chat of the user's own and opens that chat. The
 * button is for a helper that has ended and kept its steps, so `allowed` is false while it runs and
 * once it was trimmed, and the hook gives null then.
 */
export function useContinueAsChat(helperId: string, allowed: boolean): ContinueAction | null {
  const actions = useSessionActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onContinue = useCallback(() => {
    setBusy(true);
    setError(null);
    actions
      .fork(helperId)
      .catch((err: unknown) => {
        setError(actionErrorText(err, "Could not continue this helper as a chat."));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [actions, helperId]);
  return allowed ? { onContinue, busy, error } : null;
}

/** The button. It is disabled while the fork is under way, so a double click makes one chat. */
export function ContinueButton({ action, className }: { action: ContinueAction; className?: string }) {
  return (
    <Button size="sm" kind="secondary" className={className} disabled={action.busy} onClick={action.onContinue}>
      Continue as chat
    </Button>
  );
}

/** Why the last try failed, next to the button. Nothing when it did not fail. */
export function ContinueError({ action }: { action: ContinueAction | null }) {
  if (action === null || action.error === null) return null;
  return (
    <p role="alert" className="w-full text-xs text-deny">
      {action.error}
    </p>
  );
}
