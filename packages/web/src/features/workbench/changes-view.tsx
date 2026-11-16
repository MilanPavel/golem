import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import { cn } from "../../ui/cn.ts";

export type ChangesViewChoice = "file" | "turn";

export const CHANGES_VIEW_KEY = "golem.changes.view";

/** The stored choice, or `file` when there is none or storage is not available. */
function read(): ChangesViewChoice {
  try {
    return globalThis.localStorage.getItem(CHANGES_VIEW_KEY) === "turn" ? "turn" : "file";
  } catch {
    return "file";
  }
}

/** One choice for every session in the page. */
export const changesViewStore = createStore<ChangesViewChoice>(read());

export function useChangesView(): [ChangesViewChoice, (view: ChangesViewChoice) => void] {
  const view = useSyncExternalStore(changesViewStore.subscribe, changesViewStore.getSnapshot);
  const setView = useCallback((next: ChangesViewChoice) => {
    changesViewStore.set(next);
    try {
      globalThis.localStorage.setItem(CHANGES_VIEW_KEY, next);
    } catch {
      // The choice then lasts until the page closes.
    }
  }, []);
  return [view, setView];
}

const CHOICES: { view: ChangesViewChoice; label: string }[] = [
  { view: "file", label: "by file" },
  { view: "turn", label: "by turn" },
];

/** Two toggle buttons: group the changes by file or by turn. */
export function ChangesViewSwitch({ view, onChange }: { view: ChangesViewChoice; onChange: (view: ChangesViewChoice) => void }) {
  return (
    <div role="group" aria-label="Group changes" className="inline-flex self-start rounded-sm border border-line bg-sunken p-0.5 font-ui text-xs">
      {CHOICES.map((item) => (
        <button
          key={item.view}
          type="button"
          aria-pressed={view === item.view}
          className={cn(
            "rounded-xs px-2 py-0.5 font-medium outline-offset-2 outline-clay focus-visible:outline-2",
            view === item.view ? "bg-surface text-ink" : "text-muted hover:text-ink",
          )}
          onClick={() => {
            onChange(item.view);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
