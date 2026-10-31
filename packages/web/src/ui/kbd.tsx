import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "rounded-sm border border-b-2 border-line-strong bg-surface px-1.5 py-0.5 font-mono text-xs font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}
