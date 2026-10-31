import { Dialog as D } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in">
        <D.Content
          className={cn(
            "w-full max-w-md rounded-lg border border-line bg-surface p-5 text-ink shadow-soft outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            className,
          )}
          {...props}
        >
          {children}
        </D.Content>
      </D.Overlay>
    </D.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("mt-1 text-sm text-muted", className)} {...props} />;
}
