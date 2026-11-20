import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import type { GolemState } from "../../ui/golem-state.ts";
import { GearIcon, InboxIcon, PlusIcon, RoutinesIcon, RunsIcon, SearchIcon, SessionsIcon, WorkflowsIcon } from "../../ui/icons.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { isMac, modShortcut } from "../../ui/platform.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";

/** What the rail can show in the panel beside it. */
export type RailItem = "sessions" | "inbox" | "routines" | "workflows" | "runs";

/** How the link to the daemon stands: it is up, it is coming back, or the daemon is not running. */
export type RailConnection = "connected" | "reconnecting" | "offline";

export type RailProps = {
  /** The golem's state, drawn as the pixel figure. */
  state: GolemState;
  /** The daemon's version, once known. */
  version: string | null;
  connected: RailConnection;
  /** The item whose panel is in view, if any. */
  picked: RailItem | null;
  /** Sessions waiting for you. */
  inboxCount: number;
  /** The setup has a problem, or the connection is lost: the Settings icon shows a dot. */
  settingsDot: boolean;
  onPick: (item: RailItem) => void;
  onNew: () => void;
  /** `trigger` is the Search button, for focus afterwards. */
  onSearch: (trigger: HTMLElement) => void;
  onSettings: () => void;
  /** The settings page is the one in view. */
  settingsOpen?: boolean;
  /** Wraps an item's button, for a flyout that opens from it. */
  wrap?: Partial<Record<RailItem, (button: ReactElement) => ReactElement>>;
  /** The landmark's name. A page has one rail; the gallery shows several and names each. */
  label?: string;
};

/** The golem's tooltip and name: its version and whether the daemon answers. */
export function golemName(version: string | null, connected: RailConnection): string {
  if (connected === "offline") return "golem is not running";
  const head = version === null ? "golem" : `golem v${version}`;
  return `${head} · ${connected === "connected" ? "connected" : "reconnecting"}`;
}

function Divider() {
  return <div role="presentation" className="my-1 h-px w-6 shrink-0 bg-line" />;
}

type RailButtonProps = Omit<ComponentProps<"button">, "aria-label" | "children"> & {
  /** The accessible name, and the tooltip. */
  label: string;
  /** The clay bar on the left edge. */
  bar?: boolean;
  /** The icon holds the current item. */
  on?: boolean;
  /** Keep the tooltip closed, such as while a flyout from the icon is open. */
  hideTooltip?: boolean;
  children: ReactNode;
};

function RailButton({ label, bar = false, on = false, hideTooltip = false, className, children, type = "button", ...props }: RailButtonProps) {
  return (
    <Tooltip open={hideTooltip ? false : undefined}>
      <TooltipTrigger asChild>
        <button
          type={type}
          aria-label={label}
          className={cn(
            "relative grid size-9 shrink-0 place-items-center rounded-md outline-offset-2 outline-clay focus-visible:outline-2",
            on ? "bg-surface text-ink ring-1 ring-line ring-inset" : "text-muted hover:bg-line hover:text-ink",
            className,
          )}
          {...props}
        >
          {children}
          {bar ? <span aria-hidden="true" className="absolute top-2 -left-2.5 h-5 w-0.5 rounded-full bg-clay" /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

const ITEMS = {
  sessions: ["Sessions", SessionsIcon],
  inbox: ["Inbox", InboxIcon],
  routines: ["Routines", RoutinesIcon],
  workflows: ["Workflows", WorkflowsIcon],
  runs: ["Runs", RunsIcon],
} as const;

/**
 * The icon rail of the side panel: the golem, New session, the panels, Search and Settings.
 * It reads no store: everything comes in as props.
 */
export function Rail({
  state,
  version,
  connected,
  picked,
  inboxCount,
  settingsDot,
  onPick,
  onNew,
  onSearch,
  onSettings,
  settingsOpen = false,
  wrap,
  label = "Sidebar rail",
}: RailProps) {
  const golem = golemName(version, connected);
  const item = (id: RailItem) => {
    const [name, Icon] = ITEMS[id];
    const waiting = id === "inbox" && inboxCount > 0;
    const isPicked = picked === id;
    const wrapper = wrap?.[id];
    const button = (
      <RailButton
        label={waiting ? `Inbox, ${inboxCount} waiting` : name}
        on={isPicked}
        bar={isPicked}
        aria-current={isPicked ? "true" : undefined}
        onClick={() => onPick(id)}
      >
        <Icon />
        {waiting ? (
          <span
            data-testid="inbox-count"
            aria-hidden="true"
            className="absolute top-0.5 right-0 inline-flex items-center gap-0.5 rounded-sm bg-wait-soft px-1 text-meta leading-4 text-wait"
          >
            <span className="size-1.5 rounded-xs bg-wait" />
            {inboxCount > 9 ? "9+" : inboxCount}
          </span>
        ) : null}
      </RailButton>
    );
    return wrapper ? wrapper(button) : button;
  };
  return (
    <nav aria-label={label} className="flex h-full w-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-sunken py-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Not a control, but it takes focus so the tooltip opens for the keyboard too. */}
          <span
            role="img"
            aria-label={golem}
            tabIndex={0}
            className="mb-1 grid size-9 shrink-0 place-items-center rounded-md outline-offset-2 outline-clay focus-visible:outline-2"
          >
            <span aria-hidden="true">
              <PixelGolem state={state} size="sm" />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{golem}</TooltipContent>
      </Tooltip>
      <RailButton label="New session" className="border border-line-strong bg-surface text-ink" onClick={onNew}>
        <PlusIcon />
      </RailButton>
      <Divider />
      {item("sessions")}
      {item("inbox")}
      <Divider />
      {item("routines")}
      {item("workflows")}
      {item("runs")}
      <div className="flex-1" />
      <RailButton
        label={`Search ${modShortcut("K")}`}
        aria-keyshortcuts={isMac() ? "Meta+K" : "Control+K"}
        onClick={(event) => onSearch(event.currentTarget)}
      >
        <SearchIcon />
      </RailButton>
      <RailButton label="Settings" on={settingsOpen} aria-current={settingsOpen ? "page" : undefined} onClick={onSettings}>
        <GearIcon />
        {settingsDot ? <span data-testid="settings-dot" aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-xs bg-wait" /> : null}
      </RailButton>
    </nav>
  );
}
