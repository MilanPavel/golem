import { COMMANDS, type Command } from "@golem/view";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { resolveActive, SearchList } from "../../ui/search-list.tsx";
import { IN_TERMINAL_LABEL, TERMINAL_ONLY } from "../composer/terminal-only.ts";
import { paletteRows, type PaletteRow } from "./rows.ts";

export const NO_COMPOSER = "Open a session or the start page to run commands.";

export type CommandPaletteViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** A composer is on screen, so a row can run. Without one the palette lists and says why it cannot run. */
  hasComposer: boolean;
  /** Enter on a row, or a double click. Only called when `hasComposer`. */
  onPick: (row: PaletteRow) => void;
  commands?: readonly Command[];
  /** A session is open, so the Trace row is offered. */
  hasSession?: boolean;
  /** Where the search starts, for the gallery. */
  initialQuery?: string;
};

function Row({ row }: { row: PaletteRow }) {
  switch (row.kind) {
    case "message":
      return <span className="text-sm text-ink">{`Send "${row.text}"`}</span>;
    case "page":
    case "command": {
      const name = row.kind === "page" ? row.name : row.command.name;
      const args = row.kind === "command" ? row.command.args : "";
      const description = row.kind === "page" ? row.description : row.command.description;
      return (
        <span className="flex flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-sm text-clay-ink">{name}</span>
            {args === "" ? null : <span className="font-mono text-xs text-faint">{args}</span>}
            {row.key === null ? null : (
              <Kbd className="ml-auto" aria-hidden="true">
                {row.key}
              </Kbd>
            )}
          </span>
          <span className="text-sm text-muted">
            {description}
            {row.kind === "command" && TERMINAL_ONLY.has(name) ? (
              <span className="ml-2 text-xs text-faint">{IN_TERMINAL_LABEL}</span>
            ) : null}
          </span>
        </span>
      );
    }
  }
}

function Body({ hasComposer, hasSession = false, onPick, commands, initialQuery }: Omit<CommandPaletteViewProps, "open" | "onOpenChange" | "onCloseAutoFocus">) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const rows = paletteRows(commands ?? COMMANDS, query, hasSession);
  const active = resolveActive(rows, activeId);
  return (
    <>
      <SearchList
        className="mt-3"
        listClassName="max-h-64 sm:max-h-96"
        label="Search commands"
        placeholder="Search or run a command"
        items={rows}
        query={query}
        onQueryChange={setQuery}
        activeId={active?.id ?? null}
        onActiveChange={setActiveId}
        onActivate={(row) => {
          // A page row (Keys, Settings) needs no composer; a command or a message does.
          if (hasComposer || row.kind === "page") onPick(row);
        }}
        renderItem={(row) => <Row row={row} />}
        empty={<p className="px-3 py-2 text-sm text-muted">Nothing to show.</p>}
      />
      {hasComposer ? null : <p className="mt-3 text-sm text-muted">{NO_COMPOSER}</p>}
      <p className="mt-3 font-mono text-xs text-faint">{"↵ run · ↑↓ move · esc close"}</p>
    </>
  );
}

/** The ⌘K dialog: a search field over the commands, and Enter runs the active one. */
export function CommandPaletteView({ open, onOpenChange, onCloseAutoFocus, ...body }: CommandPaletteViewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-xl overflow-y-auto p-3" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <DialogDescription className="sr-only">Search for a command, or type a message, then press Enter.</DialogDescription>
        <Body {...body} />
      </DialogContent>
    </Dialog>
  );
}
