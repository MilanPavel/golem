import { Tabs as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/** Tabs on Radix: arrow keys move between the triggers, and each panel is labelled by its trigger. */
export const Tabs = T.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-1 border-b border-line", className)} {...props} />;
}

/** The look of one underline tab. The active state is added by the user: Radix's data-state, or aria-current on a link. */
export const TAB_LOOK =
  "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2";

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(TAB_LOOK, "data-[state=active]:border-clay data-[state=active]:text-ink", className)}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("outline-offset-2 outline-clay focus-visible:outline-2", className)} {...props} />;
}
