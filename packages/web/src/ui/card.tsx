import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-line bg-surface p-4 text-ink shadow-soft", className)} {...props} />;
}
