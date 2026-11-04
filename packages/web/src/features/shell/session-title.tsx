import { useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { CloseSessionDialog, RenameField } from "../sessions/index.ts";

export type SessionTitleActions = {
  rename: (title: string) => Promise<void>;
  /** Forks at the newest finished message. */
  fork: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * The top bar's title: a menu with Rename, Fork, and Close. Rename turns the title into a text
 * field. Fork is off while the session has no finished message to fork at.
 */
export function SessionTitle({
  title,
  canFork,
  actions,
  headingLevel: Heading = "h1",
}: {
  /** The title the daemon has, null for none. */
  title: string | null;
  canFork: boolean;
  actions: SessionTitleActions;
  /** The page has one h1. The gallery shows several titles and sets a lower level. */
  headingLevel?: "h1" | "h4";
}) {
  const shown = title ?? "New session";
  const [renaming, setRenaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const chose = useRef(false);

  function focusTrigger(): void {
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function fork(): void {
    setError(null);
    actions.fork().catch((err: unknown) => {
      setError(actionErrorText(err, "Could not fork the session."));
    });
  }

  return (
    <div className="-ml-2 flex min-w-0 items-center gap-3">
      <Heading className="min-w-0 text-sm leading-snug font-semibold">
        {renaming ? (
          <RenameField
            initial={title ?? ""}
            label="Session title"
            onSave={actions.rename}
            onEnd={(how) => {
              setRenaming(false);
              if (how !== "blur") focusTrigger();
            }}
          />
        ) : (
          <Menu>
            <MenuTrigger asChild>
              <button
                ref={trigger}
                type="button"
                aria-label={`Session actions: ${shown}`}
                className="flex max-w-full items-center gap-1 rounded-sm px-2 py-1 outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2 data-[state=open]:bg-line"
              >
                <span className="truncate">{shown}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted" />
              </button>
            </MenuTrigger>
            <MenuContent
              onCloseAutoFocus={(event) => {
                // The rename field or the confirm dialog takes focus next.
                if (chose.current) {
                  chose.current = false;
                  event.preventDefault();
                }
              }}
            >
              <MenuItem
                onSelect={() => {
                  chose.current = true;
                  setError(null);
                  setRenaming(true);
                }}
              >
                Rename
              </MenuItem>
              <MenuItem disabled={!canFork} onSelect={fork}>
                Fork
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  chose.current = true;
                  setError(null);
                  setClosing(true);
                }}
              >
                Close
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </Heading>
      {error === null ? null : (
        <p role="alert" className="min-w-0 truncate text-sm text-deny">
          {error}
        </p>
      )}
      <CloseSessionDialog
        open={closing}
        onOpenChange={setClosing}
        onConfirm={actions.close}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      />
    </div>
  );
}
