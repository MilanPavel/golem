import type { ComponentProps } from "react";
import { cn } from "../../ui/cn.ts";

/**
 * A text box with its unit inside the right end, such as `seconds` or `days`. The unit is part of the box's name
 * (`aria-labelledby` lists the label, then the unit), so a reader hears "Working time seconds".
 */
export function UnitField({ unit, unitId, invalid = false, disabled, className, ...props }: ComponentProps<"input"> & { unit: string; unitId: string; invalid?: boolean }) {
  return (
    <span
      className={cn(
        "flex w-full items-center rounded-md border border-line-strong bg-surface px-3 focus-within:border-clay focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-clay",
        disabled === true && "bg-sunken opacity-70",
        invalid && "border-deny outline-deny",
        className,
      )}
    >
      <input
        {...props}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        className="min-w-0 flex-1 border-0 bg-transparent py-2 font-mono text-sm text-ink outline-none placeholder:text-faint"
      />
      <span id={unitId} className="pl-2 text-xs text-faint">
        {unit}
      </span>
    </span>
  );
}
