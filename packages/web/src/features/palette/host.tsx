import { COMMANDS } from "@golem/view";
import { useEffect, useRef } from "react";
import { hasMod } from "../../ui/platform.ts";
import { activeComposer, useHasComposer } from "../composer/index.ts";
import { CommandPaletteView } from "./command-palette.tsx";
import { KeysDialog } from "./keys-dialog.tsx";
import { needsArgs } from "./needs-args.ts";
import { closePalette, openKeys, openPalette, paletteStore, usePaletteOpen } from "./open.ts";
import type { PaletteRow } from "./rows.ts";

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

function inside(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * The page's own keys: ⌘K (Ctrl+K elsewhere) toggles the palette, from anywhere, as it is not a
 * character; `?` opens the key list when focus is not in a field. Neither opens over a dialog.
 */
function usePageKeys(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key.toLowerCase() === "k" && hasMod(event) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (paletteStore.getSnapshot()?.dialog === "palette") {
          closePalette();
        } else if (document.querySelector("[role=dialog]") === null) {
          openPalette();
        }
        return;
      }
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (inside(event.target, EDITABLE) || document.querySelector("[role=dialog]") !== null) return;
      event.preventDefault();
      openKeys();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

/**
 * The palette and the key list of the page. Picking a row closes the palette first, and the row's
 * work starts once focus is back where it was, so a dialog it opens returns focus there too.
 */
export function PaletteHost() {
  usePageKeys();
  const open = usePaletteOpen();
  const hasComposer = useHasComposer();
  const then = useRef<(() => void) | null>(null);
  // Kept while a dialog closes, when `open` is already null.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open !== null) returnTo.current = open.returnTo;
  }, [open]);

  function pick(row: PaletteRow): void {
    const target = returnTo.current;
    switch (row.kind) {
      case "page":
        then.current = () => openKeys(target);
        break;
      case "message":
        then.current = () => {
          const composer = activeComposer();
          if (composer === null) return;
          void composer.run(row.text).then(
            (result) => {
              // A run in progress holds a message back: keep the text where the person can see it.
              if (result === "busy") composer.insert(row.text);
            },
            () => composer.insert(row.text),
          );
        };
        break;
      case "command": {
        const line = row.command.name;
        then.current = () => {
          const composer = activeComposer();
          if (composer === null) return;
          if (needsArgs(row.command.args)) composer.insert(`${line} `);
          else void composer.run(line);
        };
        break;
      }
    }
    closePalette();
  }

  /** Focus goes back to what had it, or to the composer; then the picked row's work runs. */
  function giveFocusBack(event: Event): void {
    event.preventDefault();
    const back = returnTo.current?.isConnected === true ? returnTo.current : null;
    (back ?? activeComposer())?.focus();
    const next = then.current;
    then.current = null;
    next?.();
  }

  return (
    <>
      <CommandPaletteView
        open={open?.dialog === "palette"}
        onOpenChange={(next) => {
          if (!next) closePalette();
        }}
        onCloseAutoFocus={giveFocusBack}
        hasComposer={hasComposer}
        onPick={pick}
        commands={COMMANDS}
      />
      <KeysDialog
        open={open?.dialog === "keys"}
        onOpenChange={(next) => {
          if (!next) closePalette();
        }}
        onCloseAutoFocus={giveFocusBack}
      />
    </>
  );
}
