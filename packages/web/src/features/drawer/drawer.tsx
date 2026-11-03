import type { TodoItem } from "@golem/view";
import { CloseIcon } from "../../ui/icons.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { TodoList } from "./todo-list.tsx";

export const DRAWER_ID = "session-details";

/**
 * The details beside the chat. On a wide window it is a column of the layout; on a narrow one it
 * floats over the right edge. Escape inside it closes it.
 */
type DrawerProps = { todos: readonly TodoItem[]; onClose: () => void; id?: string; label?: string; floating?: boolean };

export function Drawer({ todos, onClose, id = DRAWER_ID, label = "Details", floating = true }: DrawerProps) {
  return (
    <aside
      id={id}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      className={
        floating
          ? "fixed inset-y-0 right-0 z-20 flex min-h-0 w-80 max-w-11/12 flex-col border-l border-line bg-surface shadow-soft wide:static wide:z-auto wide:max-w-none wide:flex-none wide:shadow-none"
          : "flex min-h-0 w-80 flex-none flex-col border-l border-line bg-surface"
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="rounded-sm bg-sunken px-2.5 py-2 text-xs leading-none font-medium text-ink">Todos</h2>
        <IconButton label="Hide details" aria-controls={id} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <TodoList todos={todos} />
      </div>
    </aside>
  );
}
