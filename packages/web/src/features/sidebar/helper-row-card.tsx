import { helperRowCard, type HelperBlock, type HelperCardSession, type HelperSquare } from "@golem/view";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import type { InboxChoice } from "../../store/inbox.ts";
import { sendErrorText } from "../../store/errors.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover.tsx";
import { useNow } from "../sessions/use-now.ts";

export const SQUARE: Record<HelperSquare, string> = {
  working: "bg-clay",
  // Hollow, as the queued dot: the helper has not started its call.
  queued: "border border-clay",
  asking: "bg-wait",
};

/** What the card does. Without it a lead's row shows squares and no card. */
export type HelperCardActions = {
  /** Goes to the lead's chat and shows the helper in the panel. */
  open(leadId: string, helperId: string): void;
  /** `helper.stop`. */
  stop(helperId: string): Promise<void>;
  /** Answers the approval a helper asks. */
  answer(helperId: string, callId: string, choice: InboxChoice): Promise<void>;
};

/** How long the pointer rests on the row before the card opens, and may be off row and card before it closes. */
export const CARD_OPEN_DELAY = 200;
export const CARD_CLOSE_DELAY = 150;

const ANSWERS: readonly { choice: InboxChoice; label: string }[] = [
  { choice: "allow", label: "Allow once" },
  { choice: "allow_session", label: "Allow for this session" },
  { choice: "deny", label: "Deny" },
];

const FOCUSABLE = "button:not([disabled])";

function Block({ block, leadId, actions }: { block: HelperBlock; leadId: string; actions: HelperCardActions }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = [block.agent, block.title].filter((part) => part !== "").join(" ");
  const run = (job: Promise<void>) => {
    setBusy(true);
    setError(null);
    job.catch((err: unknown) => setError(sendErrorText(err))).finally(() => setBusy(false));
  };
  const asks = block.asks;
  return (
    <li data-helper-block={block.square} className={cn("flex flex-col gap-1.5 px-3 py-2", asks !== null && "bg-wait-soft")}>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span aria-hidden="true" data-square={block.square} className={cn("size-2 shrink-0 rounded-xs", SQUARE[block.square])} />
        <span className="shrink-0 font-medium">{block.agent}</span>
        <span className="min-w-0 flex-1 truncate text-muted" title={block.title}>
          {block.title}
        </span>
        {block.working === null ? null : <span className="shrink-0 font-mono text-xs text-faint">{block.working}</span>}
      </div>
      {block.waiting === null ? null : <p className="text-xs text-muted">{block.waiting}</p>}
      {block.step === null ? null : (
        <p className="truncate font-mono text-xs text-faint" title={block.step}>
          {block.step}
        </p>
      )}
      {asks === null ? null : <p className="text-sm text-pretty wrap-anywhere">{asks.text}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {asks !== null && asks.callId !== null
          ? ANSWERS.map(({ choice, label }) => (
              <Button
                key={choice}
                size="sm"
                kind={choice === "allow" ? "ink" : choice === "deny" ? "danger" : "secondary"}
                disabled={busy}
                aria-label={`${label}, ${name}`}
                onClick={() => {
                  run(actions.answer(block.sessionId, asks.callId ?? "", choice));
                }}
              >
                {label}
              </Button>
            ))
          : null}
        <Button
          size="sm"
          kind="ghost"
          aria-label={`Open ${name}`}
          onClick={() => {
            actions.open(leadId, block.sessionId);
          }}
        >
          Open
        </Button>
        <Button
          size="sm"
          kind="danger"
          disabled={busy}
          aria-label={`Stop ${name}`}
          onClick={() => {
            run(actions.stop(block.sessionId));
          }}
        >
          Stop
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-deny wrap-anywhere">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The card's body: the head line, then one block for each helper that is not done. It reads the clock
 * every second, so the working times run. Nothing when no helper is running or waiting.
 */
export function HelperRowCardBody({
  helpers,
  leadId,
  now,
  actions,
}: {
  helpers: readonly HelperCardSession[];
  leadId: string;
  /** The time to start from; the card then ticks on its own. */
  now: number;
  actions: HelperCardActions;
}) {
  // The times run from `now` as the clock moves on while the card is open.
  const ticking = useNow(1_000);
  const [opened] = useState(Date.now);
  const card = helperRowCard(helpers, now + Math.max(0, ticking - opened));
  if (card === null) return null;
  return (
    <>
      <p className="border-b border-line px-3 py-2 text-xs font-medium text-muted">{card.head}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {card.blocks.map((block) => (
          <Block key={block.sessionId} block={block} leadId={leadId} actions={actions} />
        ))}
      </ul>
    </>
  );
}

/**
 * Puts the card beside a lead's row. It opens when the pointer rests on the row, on `→` while the row's
 * link has focus, and on a click or tap on the squares (which then do not open the chat). Esc closes it
 * and gives focus back to the row. The row's other clicks work as before. `children` is the row's `li`.
 */
export function HelperRowCard({
  helpers,
  leadId,
  title,
  now,
  actions,
  children,
}: {
  helpers: readonly HelperCardSession[];
  leadId: string;
  title: string;
  now: number;
  actions: HelperCardActions | undefined;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const content = useRef<HTMLDivElement>(null);
  // The anchor's ref is typed for a div; the row is the `li` child it merges into.
  const row = useRef<HTMLDivElement>(null);
  // Opened by key or tap: the pointer leaving does not close it, and focus goes into it.
  const pinned = useRef(false);
  const focusIn = useRef(false);
  const enabled = actions !== undefined && helperRowCard(helpers, now) !== null;
  const shown = enabled && open;

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (value: boolean, delay: number) => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(value);
    }, delay);
  };
  const close = () => {
    clear();
    pinned.current = false;
    setOpen(false);
  };
  const link = () => row.current?.querySelector<HTMLElement>("a[href]") ?? null;
  const reveal = () => {
    clear();
    pinned.current = true;
    focusIn.current = true;
    setOpen(true);
  };
  useEffect(() => clear, []);

  function hover(event: PointerEvent, value: boolean): void {
    if (event.pointerType === "touch" || pinned.current) return;
    if (value) later(true, CARD_OPEN_DELAY);
    else later(false, CARD_CLOSE_DELAY);
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled || event.key !== "ArrowRight" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target !== link()) return;
    event.preventDefault();
    reveal();
  }
  function onContentKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const items = Array.from(content.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const at = event.target;
    if ((event.shiftKey && at === items[0]) || (!event.shiftKey && at === items[items.length - 1])) {
      event.preventDefault();
      close();
      link()?.focus();
    }
  }

  return (
    <Popover
      open={shown}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverAnchor
        asChild
        ref={row}
        onPointerEnter={(event: PointerEvent) => {
          hover(event, true);
        }}
        onPointerLeave={(event: PointerEvent) => {
          hover(event, false);
        }}
        onKeyDown={onKeyDown}
        onClickCapture={(event: React.MouseEvent) => {
          // A click on the squares opens the card instead of the chat. Capture runs before the link's click.
          if (enabled && event.target instanceof Element && event.target.closest("[data-testid=helper-squares]") !== null) {
            event.preventDefault();
            reveal();
          }
        }}
      >
        {children}
      </PopoverAnchor>
      {enabled ? (
        <PopoverContent
          ref={content}
          data-helper-card
          aria-label={`Helpers of ${title}`}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="w-80 max-w-11/12 overflow-hidden p-0"
          style={{ maxHeight: "var(--radix-popover-content-available-height)", overflowY: "auto" }}
          onOpenAutoFocus={(event) => {
            // Hover keeps focus where it is; a key or tap moves it to the first button.
            event.preventDefault();
            if (!focusIn.current) return;
            focusIn.current = false;
            content.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={() => {
            const inside = content.current?.contains(document.activeElement) === true;
            close();
            if (inside) link()?.focus();
          }}
          onKeyDown={onContentKeyDown}
          onPointerEnter={clear}
          onPointerLeave={(event: PointerEvent) => {
            hover(event, false);
          }}
        >
          {actions === undefined ? null : <HelperRowCardBody helpers={helpers} leadId={leadId} now={now} actions={actions} />}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
