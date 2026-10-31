import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const fieldClass =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint outline-offset-2 outline-clay focus-visible:border-clay focus-visible:outline-2 disabled:opacity-50 aria-invalid:border-deny aria-invalid:outline-deny";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}
