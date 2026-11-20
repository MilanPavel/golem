import { cn } from "../../../ui/cn.ts";

/** An on/off switch with its name given by a label element or by `label`. */
export function MemorySwitch({
  checked,
  onToggle,
  labelledBy,
  label,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  labelledBy?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full outline-offset-2 outline-clay focus-visible:outline-2 disabled:opacity-50",
        checked ? "bg-clay" : "bg-line-strong",
      )}
    >
      <span aria-hidden="true" className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform motion-reduce:transition-none", checked && "translate-x-4")} />
    </button>
  );
}
