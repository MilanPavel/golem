import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { IconButton } from "../../../ui/icon-button.tsx";
import { CheckIcon, CloseIcon } from "../../../ui/icons.tsx";
import { pullShare, pullText } from "../../models/model-text.ts";

/** How a file sits in this Mac's memory. Null or missing when golem cannot tell. */
export type Fit = "fits" | "tight" | "too_big" | null | undefined;

const FIT_TEXT = { fits: "Fits", tight: "Tight · slower", too_big: "Too big" } as const;

/** The file against this Mac's memory: a bar and a word. */
export function MemoryBar({ fit, sizeGb, ramGb }: { fit: Fit; sizeGb: number | null | undefined; ramGb: number | null }) {
  if (fit === null || fit === undefined) return <span className="text-meta text-faint">Fit unknown</span>;
  const size = sizeGb ?? null;
  const share = size === null || ramGb === null || ramGb <= 0 ? 0 : Math.min(1, size / ramGb);
  const tone = fit === "too_big" ? "text-deny" : fit === "tight" ? "text-wait" : "text-faint";
  const color = fit === "too_big" ? "bg-deny" : fit === "tight" ? "bg-wait" : "bg-allow";
  return (
    <span className={cn("flex items-center gap-2 whitespace-nowrap text-meta", tone)}>
      <span
        role="img"
        aria-label={size === null || ramGb === null ? "Memory use unknown" : `${size} GB of ${ramGb} GB of memory`}
        className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-line-strong"
      >
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      {FIT_TEXT[fit]}
    </span>
  );
}

/** What the action cell needs to know about one download. */
export type PullTarget = {
  /** The ref `model.pull` takes. */
  ref: string;
  /** The name in the labels of the buttons. */
  name: string;
  installed: boolean;
  /** The list says it is downloading, even when this page has no entry for it. */
  pulling?: boolean;
  progress?: number | null | undefined;
  tooBig?: boolean;
};

export type PullActionProps = {
  target: PullTarget;
  pulls: PullsSnapshot;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
  primary?: boolean;
};

/** Download, then a bar with a percent and a cancel, then Installed. */
export function PullAction({ target, pulls, pull, onStop, primary = false }: PullActionProps) {
  const { ref, name } = target;
  const entry = pulls.active.get(ref);
  if (entry !== undefined || target.pulling === true) {
    const share = pullShare(entry, target.progress);
    const percent = share === null ? undefined : Math.floor(share * 100);
    return (
      <span className="flex items-center justify-end gap-2" title={pullText(entry)}>
        <span
          role="progressbar"
          aria-label={`Downloading ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-line-strong"
        >
          <span className="block h-full rounded-full bg-clay" style={{ width: `${percent ?? 0}%` }} />
        </span>
        <span className="text-meta tabular-nums text-muted">{percent === undefined ? "…" : `${percent}%`}</span>
        <IconButton
          label={`Stop downloading ${name}`}
          className="size-6"
          onClick={() => {
            onStop(ref);
          }}
        >
          <CloseIcon width="12" height="12" />
        </IconButton>
      </span>
    );
  }
  if (target.installed) {
    return (
      <span className="flex items-center justify-end gap-1 text-meta font-semibold text-allow">
        <CheckIcon width="14" height="14" />
        Installed
      </span>
    );
  }
  return (
    <span className="flex justify-end">
      <Button
        size="sm"
        kind={primary ? "primary" : "secondary"}
        aria-label={`Download ${name}`}
        onClick={() => {
          void pull(ref);
        }}
      >
        {target.tooBig === true ? "Download anyway" : "Download"}
      </Button>
    </span>
  );
}
