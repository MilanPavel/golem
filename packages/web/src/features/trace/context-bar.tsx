import { contextLevel, contextPercent, contextShare, type ContextLevel } from "@golem/view";

const FILL: Record<ContextLevel, string> = { ok: "bg-clay", high: "bg-wait", full: "bg-deny" };

/** A thin bar of how full the context window is. Nothing when the window is not known. */
export function ContextBar({ used, window }: { used: number; window: number | null }) {
  const share = contextShare(used, window);
  if (window === null || share === null) return null;
  const percent = contextPercent(share);
  return (
    <div
      role="meter"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line-strong"
    >
      <div className={`h-full rounded-full ${FILL[contextLevel(used, window)]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
