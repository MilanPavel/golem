import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { cn } from "./cn.ts";

type ResizeHandleProps = {
  /** The panel's width now, in rem. */
  width: number;
  min: number;
  max: number;
  /** What one arrow key moves the handle, in rem. */
  step: number;
  label: string;
  onResize: (rem: number) => void;
  /** The panel the handle resizes. The handle sits on one of its edges, so the panel must be positioned. */
  panel: RefObject<HTMLElement | null>;
  /** Which edge of the panel the handle sits on. The default is the left edge, for a panel at the right of the page. */
  edge?: "left" | "right";
  /** Double-click on the handle calls this, to put the width back to its default. */
  onReset?: () => void;
  /** In rem. A drag that would set a width under this calls `onCollapse` once and does not call `onResize`. */
  collapseBelow?: number;
  onCollapse?: () => void;
  className?: string;
};

/**
 * The drag handle on one edge of a panel. On the left edge (a panel at the right of the page) dragging left
 * widens the panel; on the right edge (a panel at the left) dragging right widens it.
 */
export function ResizeHandle({
  width,
  min,
  max,
  step,
  label,
  onResize,
  panel,
  edge = "left",
  onReset,
  collapseBelow,
  onCollapse,
  className,
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const collapsed = useRef(false);
  const widen = edge === "left" ? "ArrowLeft" : "ArrowRight";
  const narrow = edge === "left" ? "ArrowRight" : "ArrowLeft";

  function drag(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return;
    const box = panel.current?.getBoundingClientRect();
    if (box === undefined) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const next = (edge === "left" ? box.right - event.clientX : event.clientX - box.left) / rem;
    if (collapseBelow !== undefined && next < collapseBelow) {
      if (!collapsed.current) {
        collapsed.current = true;
        onCollapse?.();
      }
      return;
    }
    onResize(next);
  }

  function key(event: KeyboardEvent<HTMLDivElement>): void {
    const to =
      event.key === widen ? width + step
      : event.key === narrow ? width - step
      : event.key === "Home" ? min
      : event.key === "End" ? max
      : null;
    if (to === null) return;
    event.preventDefault();
    onResize(to);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} rem wide`}
      tabIndex={0}
      onKeyDown={key}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        dragging.current = true;
        collapsed.current = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={drag}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className={cn(
        "absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none outline-offset-0 outline-clay hover:bg-clay/30 focus-visible:bg-clay/30 focus-visible:outline-2",
        edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        className,
      )}
    />
  );
}
