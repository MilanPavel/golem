import type { ComponentProps } from "react";
import { cn } from "./cn.ts";
import { fieldClass } from "./input.tsx";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-20 resize-y", className)} {...props} />;
}
