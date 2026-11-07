import { useEffect, useRef } from "react";
import { closeModelDialog, useModelDialogOpen } from "./model-dialog-open.ts";
import { ModelDialog } from "./model-dialog.tsx";

/** The model dialog for a screen with no session in view, opened by the sidebar's download row. */
export function NoSessionModelDialog() {
  const open = useModelDialogOpen(null);
  // The store is cleared before the dialog reports its close, so remember where focus goes back to.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open !== null && open.returnTo !== "chip") returnTo.current = open.returnTo;
  }, [open]);
  return (
    <ModelDialog
      sessionId={null}
      session={null}
      open={open !== null}
      initial={open?.initial}
      onOpenChange={(next) => {
        if (!next) closeModelDialog();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const target = returnTo.current;
        returnTo.current = null;
        if (target?.isConnected) target.focus();
      }}
    />
  );
}
