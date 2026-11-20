import { setupProblem } from "@golem/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useNavigate, useRoute, useSessionList, useSetupStatus } from "../../store/page-context.tsx";
import { useInbox } from "../../store/inbox.ts";
import { settingsPath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { PlusIcon } from "../../ui/icons.tsx";
import { hasMod } from "../../ui/platform.ts";
import { ResizeHandle } from "../../ui/resize-handle.tsx";
import { ConnectionStrip } from "../connection/index.ts";
import { NewSessionModelDialog, PullStatus } from "../models/index.ts";
import { openPalette } from "../palette/index.ts";
import { overallState } from "../sessions/index.ts";
import { useLayoutMode } from "./layout-mode.ts";
import { MENU_BUTTON_ATTR } from "./menu-button.tsx";
import { PANELS } from "./panels.tsx";
import { Rail, type RailItem } from "./rail.tsx";
import { useSidebarItem } from "./sidebar-item.ts";
import { useSidebarOpen } from "./sidebar-open.ts";
import { useSidebarOverlay } from "./sidebar-overlay.ts";
import { COLLAPSE_BELOW, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STEP, useSidebarWidth } from "./sidebar-width.ts";
import { SessionsFlyout } from "./sessions-flyout.tsx";
import { SidebarPanel, WaitingChip } from "./sidebar-panel.tsx";

const EDITABLE_RICH = "[contenteditable]:not([contenteditable='false'])";

/**
 * The rail at the left and the panel of the picked item. From 1100 px the panel sits beside the rail and
 * its open state is kept. From 760 px the rail stays and the panel floats over the page, closed until it
 * is asked for. Below that the rail is hidden too: the ☰ in the top bar opens rail and panel together
 * over the page. The page's own keys: ⌘B (Ctrl+B elsewhere) hides or shows the panel; Esc closes a
 * floating one. On the Settings page the wide layout hides the panel, as Settings lists its own sections;
 * the rail, ⌘B and the hide button then peek at it for that visit only, and the kept choice stays as it was.
 */
export function SidebarShell() {
  const sessions = useSessionList();
  const route = useRoute();
  const navigate = useNavigate();
  const connection = useConnection();
  const [item, setItem] = useSidebarItem();
  const [stored, setStored] = useSidebarOpen();
  const [overlay, setOverlay] = useSidebarOverlay();
  const [width, setWidth] = useSidebarWidth();
  const mode = useLayoutMode();
  const wide = mode === "wide";
  const narrow = mode === "narrow";
  const panel = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // The wide layout opens the panel until the person chooses; a floating one opens only when asked.
  // On Settings the wide panel is hidden until peeked at; the peek is not kept and ends with the visit.
  const inSettings = route.name === "settings";
  const [peek, setPeek] = useState(false);
  const [wasInSettings, setWasInSettings] = useState(inSettings);
  if (inSettings !== wasInSettings) {
    setWasInSettings(inSettings);
    setPeek(false);
  }
  const open = wide ? (inSettings ? peek : (stored ?? true)) : overlay;
  const setOpen = wide ? (inSettings ? setPeek : setStored) : setOverlay;
  const routeKey = JSON.stringify(route);

  const waiting = useInbox().items.length;

  const status = useSetupStatus();
  const problem = status.isError || status.data === undefined ? null : setupProblem(status.data.rows);

  const menuButton = () => document.querySelector<HTMLElement>(`[${MENU_BUTTON_ATTR}]`);

  // A floating panel closes when the page changes (a session was picked) and when the window grows wide.
  useEffect(() => {
    setOverlay(false);
  }, [routeKey, wide, setOverlay]);
  // Focus moves into a floating panel when it opens.
  useEffect(() => {
    if (wide || !overlay) return;
    // Remember what opened it, for the closes that are not a page change.
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    floating.current?.focus();
  }, [wide, overlay]);

  // Esc, the scrim, and the hide button give focus back: to the ☰ when narrow, else to what opened the panel.
  const closeFloating = () => {
    setOverlay(false);
    (narrow ? menuButton() : opener.current)?.focus();
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape" && !wide && overlay) {
        event.preventDefault();
        closeFloating();
        return;
      }
      if (event.repeat) return;
      if (event.key.toLowerCase() !== "b" || !hasMod(event) || event.shiftKey || event.altKey) return;
      // A rich text field keeps the key for bold.
      if (event.target instanceof Element && event.target.closest(EDITABLE_RICH) !== null) return;
      event.preventDefault();
      setOpen(!open);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeFloating reads refs and the same values as the deps.
  }, [open, setOpen, wide, narrow, overlay, setOverlay]);

  function pick(next: RailItem): void {
    // With the ☰ the rail and the panel come together: a click picks, and never hides the panel.
    if (next === item && !narrow) {
      setOpen(!open);
      return;
    }
    setItem(next);
    setOpen(true);
  }

  const connected = connection.state.status === "connected";
  const { title, Body } = PANELS[item];
  const rail = (
    <Rail
      state={overallState(connected, sessions.filter((session) => session.status !== "closed"))}
      version={connection.daemonVersion}
      connected={connected ? "connected" : "reconnecting"}
      picked={open ? item : null}
      inboxCount={waiting}
      settingsDot={problem !== null || !connected}
      onPick={pick}
      onNew={() => navigate("/")}
      onSearch={(trigger) => {
        // The ☰ layout's rail goes away with its panel, so the palette gives focus back to the ☰.
        if (narrow) setOverlay(false);
        openPalette(narrow ? (menuButton() ?? trigger) : trigger);
      }}
      onSettings={() => navigate(settingsPath())}
      settingsOpen={route.name === "settings"}
      wrap={{ sessions: (button) => <SessionsFlyout enabled={wide && !open} width={width}>{button}</SessionsFlyout> }}
    />
  );
  const sidebarPanel = (
    <SidebarPanel
      title={title}
      chip={item === "sessions" && waiting > 0 ? <WaitingChip count={waiting} onOpen={() => pick("inbox")} /> : null}
      action={
        item === "sessions" ? (
          <IconButton label="Start new session" className="size-7" onClick={() => navigate("/")}>
            <PlusIcon />
          </IconButton>
        ) : null
      }
      onHide={() => {
        if (wide) setOpen(false);
        else closeFloating();
      }}
      handle={
        wide ? (
          <ResizeHandle
            edge="right"
            width={width}
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            step={SIDEBAR_STEP}
            label="Resize sidebar"
            panel={panel}
            onResize={setWidth}
            onReset={() => setWidth(SIDEBAR_DEFAULT)}
            collapseBelow={COLLAPSE_BELOW}
            onCollapse={() => setOpen(false)}
          />
        ) : null
      }
      foot={
        <div className="flex flex-col gap-2">
          {open ? <PullStatus /> : null}
          <ConnectionStrip snapshot={connection} />
        </div>
      }
    >
      <Body />
    </SidebarPanel>
  );
  const panelBox: ReactNode = (
    <div ref={panel} style={{ width: `${width}rem` }} className="relative h-full min-w-40 max-w-full flex-none border-r border-line">
      {sidebarPanel}
    </div>
  );

  // The model dialog stays mounted with the panel hidden: Settings opens it too.
  const modelDialog = <NewSessionModelDialog />;
  // Settings hides the panel, so the download row sits at the foot of the page instead; the panel's foot has it otherwise.
  const strip =
    inSettings && !open ? (
      <div className={cn("pointer-events-none fixed bottom-0 z-30 w-64 max-w-full p-2", narrow ? "left-0" : "left-rail")}>
        <div className="pointer-events-auto rounded-md bg-sunken">
          <PullStatus />
        </div>
      </div>
    ) : null;
  if (wide) {
    return (
      <>
        {rail}
        {open ? panelBox : null}
        {modelDialog}{strip}
      </>
    );
  }
  const scrim = <div aria-hidden="true" data-testid="sidebar-scrim" onClick={closeFloating} className="fixed inset-0 z-40 bg-ink/40" />;
  if (narrow) {
    if (!open) return <>{modelDialog}{strip}</>;
    return (
      <>
        {scrim}
        <div
          ref={floating}
          role="dialog"
          aria-modal="true"
          aria-label="Sidebar"
          tabIndex={-1}
          className="fixed inset-y-0 left-0 z-50 flex max-w-full outline-none"
        >
          {rail}
          {panelBox}
        </div>
        {modelDialog}{strip}
      </>
    );
  }
  return (
    <>
      {rail}
      {open ? (
        <>
          {scrim}
          <div ref={floating} tabIndex={-1} className="fixed inset-y-0 left-rail z-50 flex max-w-full shadow-lg outline-none">
            {panelBox}
          </div>
        </>
      ) : null}
      {modelDialog}{strip}
    </>
  );
}
