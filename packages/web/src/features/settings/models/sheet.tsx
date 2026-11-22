import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { IconButton } from "../../../ui/icon-button.tsx";
import { CloseIcon } from "../../../ui/icons.tsx";

/** A panel over the page for one job: a title, a line under it, and a close button. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-dvh max-w-xl flex-col gap-4 overflow-y-auto">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <IconButton
            label="Close"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <CloseIcon />
          </IconButton>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}
