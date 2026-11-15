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
  /** The panel the handle resizes. The handle sits on its left edge, so the panel must be positioned. */
  panel: RefObject<HTMLElement | null>;
  className?: string;
};

/** The drag handle on the left edge of a panel at the right of the page. Dragging left widens the panel. */
export function ResizeHandle({ width, min, max, step, label, onResize, panel, className }: ResizeHandleProps) {
  const dragging = useRef(false);

  function drag(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return;
    const right = panel.current?.getBoundingClientRect().right;
    if (right === undefined) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    onResize((right - event.clientX) / rem);
  }

  function key(event: KeyboardEvent<HTMLDivElement>): void {
    const to =
      event.key === "ArrowLeft" ? width + step
      : event.key === "ArrowRight" ? width - step
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
      onPointerDown={(event) => {
        dragging.current = true;
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
        "absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none outline-offset-0 outline-clay hover:bg-clay/30 focus-visible:bg-clay/30 focus-visible:outline-2",
        className,
      )}
    />
  );
}
