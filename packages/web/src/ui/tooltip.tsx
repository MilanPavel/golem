import { Tooltip as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const TooltipProvider = T.Provider;

/** A tooltip that works without a provider around it. A shared TooltipProvider is optional. */
export function Tooltip(props: ComponentProps<typeof T.Root>) {
  return (
    <T.Provider>
      <T.Root {...props} />
    </T.Provider>
  );
}
export const TooltipTrigger = T.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-sm bg-ink px-2 py-1 text-xs text-bg data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </T.Portal>
  );
}
