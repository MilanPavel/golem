import type { ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { useWorkbenchTab, useWorkbenchWide } from "./workbench-state.ts";

export const WORKBENCH_ID = "session-details";

export type WorkbenchTab = { id: string; label: string; badge?: string; render: () => ReactNode };

type WorkbenchProps = { tabs: readonly WorkbenchTab[]; onClose: () => void; id?: string; floating?: boolean };

/**
 * The panel beside the chat, with a tab per view. On a wide window it is a column of the layout; on a
 * narrow one it floats over the right edge. Escape inside it closes it.
 */
export function Workbench({ tabs, onClose, id = WORKBENCH_ID, floating = true }: WorkbenchProps) {
  const [chosen, setTab] = useWorkbenchTab();
  const [wide, setWide] = useWorkbenchWide();
  const first = tabs[0];
  if (first === undefined) {
    return null;
  }
  const active = tabs.find((tab) => tab.id === chosen)?.id ?? first.id;
  const width = wide ? "w-workbench-wide" : "w-80";
  return (
    <aside
      id={id}
      aria-label="Details"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      className={
        floating
          ? cn(
              "fixed inset-y-0 right-0 z-20 flex min-h-0 max-w-11/12 flex-col border-l border-line bg-surface shadow-soft wide:static wide:z-auto wide:max-w-none wide:flex-none wide:shadow-none",
              width,
            )
          : cn("flex min-h-0 flex-none flex-col border-l border-line bg-surface", width)
      }
    >
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
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              aria-pressed={wide}
              onClick={() => setWide(!wide)}
              className={cn(
                "rounded-sm px-2 py-2 text-xs leading-none text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2",
                wide && "bg-sunken text-ink",
              )}
            >
              Wide
            </button>
            <IconButton label="Hide details" aria-controls={id} onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 data-[state=active]:flex">
            {tab.render()}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
