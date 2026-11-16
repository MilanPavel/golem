import { setupProblem } from "@golem/view";
import { useEffect, useRef } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { useNavigate, useRoute, useSessionList, useSetupStatus } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { PlusIcon } from "../../ui/icons.tsx";
import { hasMod } from "../../ui/platform.ts";
import { ResizeHandle } from "../../ui/resize-handle.tsx";
import { ConnectionStrip } from "../connection/index.ts";
import { NewSessionModelDialog, PullStatus } from "../models/index.ts";
import { openPalette } from "../palette/index.ts";
import { overallState } from "../sessions/index.ts";
import { PANELS } from "./panels.tsx";
import { Rail, type RailItem } from "./rail.tsx";
import { useSidebarItem } from "./sidebar-item.ts";
import { useSidebarOpen } from "./sidebar-open.ts";
import { COLLAPSE_BELOW, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STEP, useSidebarWidth } from "./sidebar-width.ts";
import { SidebarPanel } from "./sidebar-panel.tsx";

const EDITABLE_RICH = "[contenteditable]:not([contenteditable='false'])";

/**
 * The rail at the left and, when it is open, the panel of the picked item beside it. This is the wide
 * layout. The page's own keys: ⌘B (Ctrl+B elsewhere) hides or shows the panel.
 */
export function SidebarShell() {
  const sessions = useSessionList();
  const route = useRoute();
  const navigate = useNavigate();
  const connection = useConnection();
  const [item, setItem] = useSidebarItem();
  const [stored, setOpen] = useSidebarOpen();
  const [width, setWidth] = useSidebarWidth();
  const panel = useRef<HTMLDivElement>(null);
  // The wide layout opens the panel until the person chooses.
  const open = stored ?? true;
  const toggle = () => setOpen(!open);

  const status = useSetupStatus();
  const problem = status.isError || status.data === undefined ? null : setupProblem(status.data.rows);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
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
  }, [open, setOpen]);

  function pick(next: RailItem): void {
    if (next === item) {
      toggle();
      return;
    }
    setItem(next);
    setOpen(true);
  }

  const connected = connection.state.status === "connected";
  const { title, Body } = PANELS[item];
  return (
    <>
      <Rail
        state={overallState(connected, sessions.filter((session) => session.status !== "closed"))}
        version={connection.daemonVersion}
        connected={connected ? "connected" : "reconnecting"}
        picked={open ? item : null}
        // The Inbox panel counts these once it is mounted here.
        inboxCount={0}
        settingsDot={problem !== null || !connected}
        onPick={pick}
        onNew={() => navigate("/")}
        onSearch={openPalette}
        onSettings={() => navigate(settingsPath())}
        settingsOpen={route.name === "settings"}
      />
      {open ? (
        <div
          ref={panel}
          style={{ width: `${width}rem` }}
          className="relative h-full min-w-40 flex-none border-r border-line"
        >
          <SidebarPanel
            title={title}
            action={
              item === "sessions" ? (
                <IconButton label="Start new session" className="size-7" onClick={() => navigate("/")}>
                  <PlusIcon />
                </IconButton>
              ) : null
            }
            onHide={() => setOpen(false)}
            handle={
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
            }
            foot={
              <div className="flex flex-col gap-2">
                <PullStatus />
                <NewSessionModelDialog />
                <ConnectionStrip snapshot={connection} />
              </div>
            }
          >
            <Body />
          </SidebarPanel>
        </div>
      ) : null}
    </>
  );
}
