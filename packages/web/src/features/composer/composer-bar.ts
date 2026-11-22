import { cn } from "../../ui/cn.ts";

/**
 * The look of a chip in the composer's row: quiet, 30 px tall, with no border until it is hovered or
 * open. Chips may shrink; a label that does not fit is cut with an ellipsis.
 */
export const BAR_CHIP = cn(
  "inline-flex h-7.5 min-w-0 shrink cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border-0 bg-transparent px-2 text-meta text-muted",
  "outline-offset-2 outline-clay hover:bg-sunken hover:text-ink focus-visible:outline-2 data-[state=open]:bg-sunken data-[state=open]:text-ink",
  "disabled:cursor-default disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
);

/** The text of a chip that turns into an icon when the composer is under 500 px wide. It stays for screen readers. */
export const ICON_UNDER_500 = "@max-row-500/comp:sr-only";
/** The same, under 400 px. */
export const ICON_UNDER_400 = "@max-row-400/comp:sr-only";
