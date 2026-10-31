import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium outline-offset-2 outline-clay focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      kind: {
        primary: "border-clay bg-clay text-on-clay hover:brightness-105",
        secondary: "border-line-strong bg-surface text-ink hover:border-ink",
        ghost: "border-transparent bg-transparent text-muted hover:bg-line hover:text-ink",
        danger: "border-line-strong bg-surface text-deny hover:border-deny",
      },
      size: {
        sm: "px-2.5 py-1 text-xs",
        md: "px-3 py-2 text-sm",
      },
    },
    defaultVariants: { kind: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ kind, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ kind, size }), className)} {...props} />;
}
