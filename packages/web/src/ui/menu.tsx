import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;

export function MenuContent({ className, sideOffset = 6, align = "start", ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-44 rounded-md border border-line bg-surface p-1 text-sm text-ink shadow-soft data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-disabled:opacity-50 data-highlighted:bg-line",
        className,
      )}
      {...props}
    />
  );
}

export const MenuRadioGroup = M.RadioGroup;

/** A choice in a radio group: the dot marks the one that holds, and Radix sets `role="menuitemradio"`. */
export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem
      className={cn(
        "flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 outline-none data-disabled:opacity-50 data-highlighted:bg-line",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="mt-1.5 flex size-2 shrink-0 items-center justify-center">
        <M.ItemIndicator className="size-2 rounded-full bg-ink" />
      </span>
      <span className="flex min-w-0 flex-col">{children}</span>
    </M.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2 py-1.5 font-mono text-xs text-faint", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
