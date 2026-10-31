import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label" | "children"> & {
  /** The accessible name, and the tooltip text. */
  label: string;
  children: ReactNode;
};

export function IconButton({ label, children, className, type = "button", ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type={type}
          aria-label={label}
          className={cn(
            "inline-grid size-8 place-items-center rounded-sm text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
