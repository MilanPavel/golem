import type { ChecksTone } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { openWorkbench } from "../workbench/workbench-state.ts";

const TONE: Record<ChecksTone, string> = {
  run: "bg-wait-soft text-wait",
  ok: "bg-allow-soft text-allow",
  bad: "bg-deny-soft text-deny",
};

/**
 * The line under a turn's last answer that says how its checks went: `✓ checks passed`, `◐ checking…`
 * or `✗ ruff: failed`, the detail beside it, and Show, which opens the panel on Checks.
 */
export function ChecksStrip({ tone, text, detail, onShow = () => openWorkbench("checks") }: { tone: ChecksTone; text: string; detail: string; onShow?: () => void }) {
  return (
    <div data-checks-strip data-tone={tone} className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-1.5 text-meta", TONE[tone])}>
      <span className="font-medium">{text}</span>
      {detail === "" ? null : <span className="min-w-0 flex-1 truncate">{detail}</span>}
      <button
        type="button"
        aria-label="Show the checks"
        onClick={onShow}
        className="ml-auto cursor-pointer rounded-sm px-1.5 py-0.5 font-medium underline outline-offset-2 outline-clay hover:no-underline focus-visible:outline-2"
      >
        Show
      </button>
    </div>
  );
}
