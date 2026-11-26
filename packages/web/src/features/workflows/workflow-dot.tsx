import type { WorkflowEntryInfo } from "../../store/workflows.ts";
import { cn } from "../../ui/cn.ts";

const MARK: Record<WorkflowEntryInfo["state"], string> = {
  ok: "border border-line-strong",
  broken: "bg-deny",
  untrusted: "bg-wait",
};

const WORD: Record<WorkflowEntryInfo["state"], string> = {
  ok: "ready",
  broken: "broken",
  untrusted: "not trusted",
};

/** A workflow's mark in a list: hollow when it is ready, filled when its file does not load or sits in a folder you have not trusted. */
export function WorkflowDot({ state }: { state: WorkflowEntryInfo["state"] }) {
  return (
    <span className="inline-flex w-3.5 shrink-0 justify-center">
      <span aria-hidden="true" className={cn("size-2 rounded-xs", MARK[state])} />
      <span className="sr-only">{WORD[state]}</span>
    </span>
  );
}
