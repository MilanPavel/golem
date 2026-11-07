import { useRef, useState, type ReactNode } from "react";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, FolderIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover.tsx";
import { folderName } from "../sessions/folder.ts";
import type { FolderBrowserProps } from "./folder-browser.tsx";

export { parseTypedPath } from "./folder-browser.tsx";

export type FolderChipProps = {
  folder: string | null;
  /** The folders to offer, newest first. */
  folders: readonly string[];
  onChange: (folder: string | null) => void;
  /** The folder browser, for `Choose a folder…`. Without it the item is not offered. */
  browser?: (props: FolderBrowserProps) => ReactNode;
};

/** The folder the next session will run in, with a menu to change it. Read-only chips are Badges. */
export function FolderChip({ folder, folders, onChange, browser }: FolderChipProps) {
  const [browsing, setBrowsing] = useState(false);
  const wantsBrowser = useRef(false);
  const content = useRef<HTMLDivElement>(null);

  return (
    <Popover open={browsing} onOpenChange={setBrowsing}>
      <Menu>
        <PopoverAnchor asChild>
          <MenuTrigger
            title={folder ?? undefined}
            aria-label={`Folder: ${folderName(folder)}`}
            className={cn(badgeVariants(), "cursor-pointer outline-offset-2 outline-clay hover:border-line-strong hover:text-ink focus-visible:outline-2")}
          >
            <FolderIcon className="size-3" />
            {folderName(folder)}
            <ChevronDownIcon className="size-3" />
          </MenuTrigger>
        </PopoverAnchor>
        <MenuContent
          onCloseAutoFocus={(event) => {
            if (wantsBrowser.current) {
              // The browser opens once the menu has closed, so the two do not fight over focus.
              wantsBrowser.current = false;
              event.preventDefault();
              setBrowsing(true);
            }
          }}
        >
          {folders.map((path) => (
            <MenuItem key={path} title={path} aria-current={path === folder ? "true" : undefined} onSelect={() => onChange(path)}>
              <span className="max-w-80 truncate font-mono text-xs">{path}</span>
              {path === folder ? <span aria-hidden="true" className="ml-auto text-clay-ink">✓</span> : null}
            </MenuItem>
          ))}
          <MenuItem aria-current={folder === null ? "true" : undefined} onSelect={() => onChange(null)}>
            No folder
            {folder === null ? <span aria-hidden="true" className="ml-auto text-clay-ink">✓</span> : null}
          </MenuItem>
          {browser === undefined ? null : (
            <>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  wantsBrowser.current = true;
                }}
              >
                Choose a folder…
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <PopoverContent
        ref={content}
        align="start"
        aria-label="Choose a folder"
        className="w-96"
        onOpenAutoFocus={(event) => {
          // Focus goes to the filter field, which takes the keys.
          event.preventDefault();
          content.current?.querySelector("input")?.focus();
        }}
      >
        {browsing && browser !== undefined
          ? browser({
              initialPath: folder,
              autoFocus: false,
              onPick: (path) => {
                onChange(path);
                setBrowsing(false);
              },
              onCancel: () => setBrowsing(false),
            })
          : null}
      </PopoverContent>
    </Popover>
  );
}
