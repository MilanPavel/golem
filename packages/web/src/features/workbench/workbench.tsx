import { useRef, type ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { ResizeHandle } from "../../ui/resize-handle.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { useWorkbenchTab } from "./workbench-state.ts";
import { WORKBENCH_DEFAULT, WORKBENCH_MAX, WORKBENCH_MIN, WORKBENCH_STEP, useWorkbenchWidth } from "./workbench-width.ts";

export const WORKBENCH_ID = "session-details";

export type WorkbenchTab = { id: string; label: string; badge?: string; render: () => ReactNode };

type WorkbenchProps = { tabs: readonly WorkbenchTab[]; onClose: () => void; id?: string; floating?: boolean };

/**
 * The panel beside the chat, with a tab per view. On a wide window it is a column of the layout, and
 * dragging its left edge resizes it; on a narrow one it floats over the right edge. Escape inside it
 * closes it.
 */
export function Workbench({ tabs, onClose, id = WORKBENCH_ID, floating = true }: WorkbenchProps) {
  const [chosen, setTab] = useWorkbenchTab();
  const [width, setWidth] = useWorkbenchWidth();
  const panel = useRef<HTMLElement>(null);
  const first = tabs[0];
  if (first === undefined) {
    return null;
  }
  const active = tabs.find((tab) => tab.id === chosen)?.id ?? first.id;
  return (
    <aside
      ref={panel}
      id={id}
      aria-label="Details"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      style={width === WORKBENCH_DEFAULT ? undefined : { width: `${width}rem` }}
      className={cn(
        "flex min-h-0 w-80 flex-col border-l border-line bg-surface",
        floating
          ? "fixed inset-y-0 right-0 z-20 max-w-11/12 shadow-soft wide:relative wide:z-auto wide:max-w-3/5 wide:flex-none wide:shadow-none"
          : "relative max-w-3/5 flex-none",
      )}
    >
      <ResizeHandle
        width={width}
        min={WORKBENCH_MIN}
        max={WORKBENCH_MAX}
        step={WORKBENCH_STEP}
        label="Resize the details"
        onResize={setWidth}
        panel={panel}
        className={floating ? "max-wide:hidden" : undefined}
      />
      <Tabs value={active} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <TabsList className="min-w-0 border-b-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="mb-0 flex items-center gap-1.5 rounded-sm border-b-0 px-2.5 py-2 text-xs leading-none font-medium data-[state=active]:bg-sunken"
              >
                {tab.label}
                {tab.badge === undefined ? null : <span className="font-normal text-faint">{tab.badge}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <IconButton label="Hide details" aria-controls={id} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="relative min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 data-[state=active]:flex">
            {tab.render()}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
