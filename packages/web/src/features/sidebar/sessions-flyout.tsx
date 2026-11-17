import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover.tsx";
import { PANELS } from "./panels.tsx";

/** How long the pointer rests on the icon before the flyout opens. */
export const FLYOUT_OPEN_DELAY = 100;
/** How long the pointer may be off both the icon and the flyout before it closes, so crossing the gap is safe. */
export const FLYOUT_CLOSE_DELAY = 150;

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

export type SessionsFlyoutProps = {
  /** The flyout applies only while the panel is hidden on the wide layout. */
  enabled: boolean;
  /** The stored panel width in rem: the flyout is as wide. */
  width: number;
  /** The Sessions rail button. */
  children: ReactElement;
};

/**
 * The Sessions list in a floating box at the right of the rail icon. It opens when the pointer rests on
 * the icon or the icon takes focus, and closes on Esc, when the pointer leaves, when focus leaves, and
 * after a session is picked. It shows the same list as the panel.
 */
export function SessionsFlyout({ enabled, width, children }: SessionsFlyoutProps) {
  const [shown, setShown] = useState(false);
  const open = enabled && shown;
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set after Esc gives focus back to the icon, so that focus does not open the flyout again.
  const quiet = useRef(false);
  const { Body } = PANELS.sessions;

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (value: boolean, delay: number) => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(value);
    }, delay);
  };
  const close = () => {
    clear();
    setShown(false);
  };
  useEffect(() => clear, []);
  // A flyout the panel has taken over must not wake up again when the panel is hidden.
  if (!enabled && shown) setShown(false);

  const icon = () => anchor.current?.querySelector("button") ?? null;
  const inside = (node: EventTarget | null) =>
    node instanceof Node && (anchor.current?.contains(node) === true || content.current?.contains(node) === true);

  function onFocus(event: FocusEvent): void {
    if (!enabled || event.target !== icon() || quiet.current) return;
    clear();
    setShown(true);
  }
  function onBlur(event: FocusEvent): void {
    if (event.target === icon()) quiet.current = false;
    // A null target is a click on something that cannot take focus; the click closes it, if it should.
    if (event.relatedTarget !== null && !inside(event.relatedTarget)) close();
  }
  function onKeyDown(event: KeyboardEvent): void {
    // The box is at the end of the page, so Tab from the icon goes into it by hand.
    if (!open || event.key !== "Tab" || event.shiftKey || event.target !== icon()) return;
    const first = content.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (first === null || first === undefined) return;
    event.preventDefault();
    first.focus();
  }

  // Tab past the last item goes on to the next rail button; Shift+Tab from the first goes back to the icon.
  function onContentKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const items = Array.from(content.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const at = event.target;
    if (event.shiftKey && at === items[0]) {
      event.preventDefault();
      icon()?.focus();
    } else if (!event.shiftKey && at === items[items.length - 1]) {
      event.preventDefault();
      close();
      const next = anchor.current?.nextElementSibling;
      const target = next?.matches("button") === true ? next : next?.querySelector("button");
      (target instanceof HTMLElement ? target : icon())?.focus();
    }
  }

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div
          ref={anchor}
          onPointerEnter={() => enabled && later(true, FLYOUT_OPEN_DELAY)}
          onPointerLeave={() => later(false, FLYOUT_CLOSE_DELAY)}
          onClick={close}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        >
          {cloneElement(children as ReactElement<Record<string, unknown>>, {
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            hideTooltip: open,
            "aria-controls": open ? id : undefined,
          })}
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        id={id}
        aria-label="Sessions"
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        style={{ width: `${width}rem`, maxHeight: "var(--radix-popover-content-available-height)" }}
        className="overflow-y-auto border-line-strong p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={() => {
          close();
          quiet.current = true;
          icon()?.focus();
        }}
        onKeyDown={onContentKeyDown}
        onPointerEnter={clear}
        onPointerLeave={() => later(false, FLYOUT_CLOSE_DELAY)}
        onBlur={onBlur}
        onClick={(event) => {
          // Picking a session goes to it, and the flyout has done its job.
          if (event.target instanceof Element && event.target.closest("a[href]") !== null) close();
        }}
      >
        <Body />
      </PopoverContent>
    </Popover>
  );
}
