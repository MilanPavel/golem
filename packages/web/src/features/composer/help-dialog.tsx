import type { Command, CommandGroup } from "@golem/view";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IN_TERMINAL_LABEL, TERMINAL_ONLY } from "./terminal-only.ts";

const GROUPS: readonly { group: CommandGroup; title: string }[] = [
  { group: "session", title: "Session" },
  { group: "model", title: "Model" },
  { group: "tools", title: "Tools" },
  { group: "view", title: "View" },
];

/** The slash commands, grouped, with a note on the ones that live in the terminal for now. */
export function CommandsDialog({
  open,
  onOpenChange,
  commands,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly Command[];
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>Commands</DialogTitle>
        <DialogDescription>Type / in the message box to pick one. // sends a message that starts with a slash.</DialogDescription>
        <div className="mt-4 flex flex-col gap-5">
          {GROUPS.map(({ group, title }) => {
            const rows = commands.filter((command) => command.group === group);
            if (rows.length === 0) return null;
            const headingId = `commands-${group}`;
            return (
              <section key={group} aria-labelledby={headingId}>
                <h3 id={headingId} className="px-1 pb-1 font-mono text-xs font-normal text-faint">
                  {title}
                </h3>
                <ul className="flex list-none flex-col gap-0.5 p-0">
                  {rows.map((command) => (
                    <li key={command.name} className="flex flex-col gap-0.5 rounded-md px-3 py-2 sm:flex-row sm:items-baseline sm:gap-4">
                      <span className="shrink-0 font-mono text-sm text-clay-ink sm:w-56">
                        {command.name}
                        {command.args === "" ? null : <span> {command.args}</span>}
                      </span>
                      <span className="min-w-0 text-sm text-muted">
                        {command.description}
                        {TERMINAL_ONLY.has(command.name) ? (
                          <span className="ml-2 text-xs text-faint">{IN_TERMINAL_LABEL}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
