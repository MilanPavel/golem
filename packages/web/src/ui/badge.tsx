import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface text-muted",
        clay: "border-transparent bg-clay-soft text-clay-ink",
        allow: "border-transparent bg-allow-soft text-allow",
        deny: "border-transparent bg-deny-soft text-deny",
        wait: "border-transparent bg-wait-soft text-wait",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
