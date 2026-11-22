import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

const TONES = { ink: "text-ink", muted: "text-muted", inherit: "" } as const;

/** An inline literal you could paste: a path, command, model id, host or key. The one place mono text starts. */
export function Code({ tone = "ink", className, ...props }: ComponentProps<"code"> & { tone?: keyof typeof TONES }) {
  return <code className={cn("font-mono text-code", TONES[tone], className)} {...props} />;
}
