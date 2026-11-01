import { useId, useRef, useState, type FormEvent } from "react";
import { badgeVariants } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, FolderIcon } from "../../ui/icons.tsx";
import { Input } from "../../ui/input.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover.tsx";
import { folderName } from "../sessions/folder.ts";

export const PATH_ERROR = "Enter an absolute path, starting with /.";

/** A typed path is a string that starts with `/` once trimmed. The daemon checks the rest. */
export function parseTypedPath(text: string): string | null {
  const path = text.trim();
  return path.startsWith("/") ? path : null;
}

export type FolderChipProps = {
  folder: string | null;
  /** The folders to offer, newest first. */
  folders: readonly string[];
  onChange: (folder: string | null) => void;
};

/** The folder the next session will run in, with a menu to change it. Read-only chips are Badges. */
export function FolderChip({ folder, folders, onChange }: FolderChipProps) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const wantsInput = useRef(false);
  const errorId = useId();

  function submit(event: FormEvent): void {
    event.preventDefault();
    const path = parseTypedPath(text);
    if (path === null) {
      setError(true);
      return;
    }
    onChange(path);
    setTyping(false);
  }

  return (
    <Popover
      open={typing}
      onOpenChange={(open) => {
        setTyping(open);
        if (open) {
          setText(folder ?? "");
          setError(false);
        }
      }}
    >
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
            if (wantsInput.current) {
              wantsInput.current = false;
              event.preventDefault();
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
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              wantsInput.current = true;
              setText(folder ?? "");
              setError(false);
              setTyping(true);
            }}
          >
            Type a path…
          </MenuItem>
        </MenuContent>
      </Menu>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={`${errorId}-path`} className="text-xs text-muted">
            Folder path
          </label>
          <Input
            id={`${errorId}-path`}
            value={text}
            placeholder="/Users/you/project"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className="font-mono"
            onChange={(event) => {
              setText(event.target.value);
              setError(false);
            }}
          />
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-deny">
              {PATH_ERROR}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" kind="ghost" onClick={() => setTyping(false)}>
              Cancel
            </Button>
            <Button size="sm" kind="primary" type="submit">
              Use this folder
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
