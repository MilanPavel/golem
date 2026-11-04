import { useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";

/**
 * Asks before a session leaves the list. Close runs `onConfirm`; the dialog shuts when it
 * resolves and shows the message when it fails.
 */
export function CloseSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean): void {
    if (busy) return;
    setError(null);
    onOpenChange(next);
  }

  function confirm(): void {
    setBusy(true);
    setError(null);
    onConfirm().then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (err: unknown) => {
        setBusy(false);
        setError(actionErrorText(err, "Could not close the session."));
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>Close this session?</DialogTitle>
        <DialogDescription>It leaves the list. Its history stays in the log.</DialogDescription>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-deny">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button kind="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button kind="danger" disabled={busy} onClick={confirm}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
