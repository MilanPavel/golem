/** A download's bar and the words beside it. `share` is 0 to 1, or null when nobody knows yet. */
export function PullBar({ label, share, text }: { label: string; share: number | null; text: string }) {
  const percent = share === null ? undefined : Math.floor(share * 100);
  return (
    <div className="mt-1.5 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-line-strong"
      >
        <div className="h-full rounded-full bg-clay" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <span className="font-mono text-xs text-muted">{text}</span>
    </div>
  );
}
