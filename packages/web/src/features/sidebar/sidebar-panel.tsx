import type { ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import { PanelIcon } from "../../ui/icons.tsx";
import { isMac, modShortcut } from "../../ui/platform.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";

export type SidebarPanelProps = {
  /** The heading, and the landmark's name: "Sessions", "Inbox", and so on. */
  title: string;
  /** The landmark's name, when it is not the title. A page has one panel; the gallery shows several and names each. */
  label?: string;
  /** A small chip beside the title, such as "2 waiting". */
  chip?: ReactNode;
  /** The header's action, such as the + on Sessions. */
  action?: ReactNode;
  onHide: () => void;
  /** The resize handle. It sits inside the landmark, on the panel's right edge. */
  handle?: ReactNode;
  /** The panel's foot: downloads and the connection strip. */
  foot?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** The panel beside the rail: a header (title, chip, action, hide), the body, and a foot. */
export function SidebarPanel({ title, label = title, chip, action, onHide, handle, foot, children, className }: SidebarPanelProps) {
  return (
    <aside aria-label={label} className={cn("relative flex h-full min-w-0 flex-col gap-2 bg-sunken px-2.5 pt-3 pb-2.5 text-sm", className)}>
      <div className="flex items-center gap-2 px-1.5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {chip}
        <div className="flex-1" />
        {action}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Hide sidebar"
              aria-keyshortcuts={isMac() ? "Meta+B" : "Control+B"}
              onClick={onHide}
              className="inline-grid size-7 place-items-center rounded-sm text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2"
            >
              <PanelIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent>Hide sidebar {modShortcut("B")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {foot}
      {handle}
    </aside>
  );
}
