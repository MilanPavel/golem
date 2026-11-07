import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";
import type { FsListDirsResult } from "../../store/dirs.ts";
import { useDirs } from "../../store/page-context.tsx";

/** A typed path is a string that starts with `/` once trimmed. The daemon checks the rest. */
export function parseTypedPath(text: string): string | null {
  const path = text.trim();
  return path.startsWith("/") ? path : null;
}

/** A filter value that names a place, not a folder to find: `/…`, `~`, or `~/…`. */
export function looksLikePath(text: string): boolean {
  const value = text.trim();
  return value.startsWith("/") || value === "~" || value.startsWith("~/");
}

/** The place a typed value names: `~/code` is `code` under `home`, an absolute path is itself, else null. */
export function resolveTyped(text: string, home: string | null): string | null {
  const value = text.trim();
  if (value === "~" || value.startsWith("~/")) {
    return home === null ? null : `${home}${value.slice(1)}`.replace(/\/+$/, "") || "/";
  }
  return parseTypedPath(value)?.replace(/(?<=.)\/+$/, "") ?? null;
}

/** Whether `path` is `home` or below it. */
export function underHome(path: string, home: string): boolean {
  return path === home || path.startsWith(home.endsWith("/") ? home : `${home}/`);
}

/** The breadcrumb of a listing: `~`, then each folder below home, each with the path it goes to. */
export function crumbs(listing: Pick<FsListDirsResult, "path" | "home">): { label: string; path: string }[] {
  const out = [{ label: "~", path: listing.home }];
  const rest = listing.path === listing.home ? "" : listing.path.slice(listing.home.length + 1);
  let path = listing.home;
  for (const part of rest.split("/").filter((item) => item !== "")) {
    path = `${path}/${part}`;
    out.push({ label: part, path });
  }
  return out;
}

export type FolderBrowserViewProps = {
  /** The folders being shown, or null while there is nothing yet. */
  listing: FsListDirsResult | null;
  loading: boolean;
  /** Why the listing could not be had. */
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** Go into a folder. */
  onOpen: (path: string) => void;
  /** Go up one folder; at home there is nothing above, and an error goes home. */
  onUp: () => void;
  /** The filter holds a path and Enter was pressed. */
  onGoTyped: (text: string) => void;
  onRetry: () => void;
  /** `Use this folder`: the folder shown. */
  onPick: (path: string) => void;
  onCancel: () => void;
  /** Where focus starts. The page's popover sets it by hand, so it is off in the gallery. */
  autoFocus?: boolean;
  /** The breadcrumb's name. The gallery shows several browsers, so each needs its own. */
  navLabel?: string;
};

/** The folder picker's body: a breadcrumb, a filter, the subfolders, and the two buttons. */
export function FolderBrowserView({
  listing,
  loading,
  error,
  query,
  onQueryChange,
  onOpen,
  onUp,
  onGoTyped,
  onRetry,
  onPick,
  onCancel,
  autoFocus = true,
  navLabel = "Folder path",
}: FolderBrowserViewProps) {
  const base = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const typing = looksLikePath(query);
  const needle = query.trim().toLowerCase();
  const shown = (listing?.entries ?? []).filter((entry) => typing || needle === "" || entry.name.toLowerCase().includes(needle));
  const active = shown.find((entry) => entry.path === activeId) ?? shown[0] ?? null;
  const activeIndex = active === null ? -1 : shown.indexOf(active);
  const optionId = (index: number) => `${base}-option-${index}`;
  const activeDomId = activeIndex < 0 ? undefined : optionId(activeIndex);

  useEffect(() => {
    if (activeDomId !== undefined) document.getElementById(activeDomId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeDomId]);

  function move(to: number): void {
    const next = shown[Math.min(Math.max(to, 0), shown.length - 1)];
    if (next !== undefined) setActiveId(next.path);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const input = event.currentTarget;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const at = Math.max(activeIndex, 0);
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "ArrowRight":
        if (!atEnd || active === null || typing) return;
        onOpen(active.path);
        break;
      case "Enter":
        if (typing) onGoTyped(query);
        else if (active !== null) onOpen(active.path);
        else return;
        break;
      case "ArrowLeft":
        if (query !== "") return;
        onUp();
        break;
      case "Backspace":
        if (query !== "") return;
        onUp();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const listed = shown.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {listing === null ? null : (
        <nav aria-label={navLabel} className="flex flex-wrap items-center gap-0.5 font-mono text-xs">
          {crumbs(listing).map((crumb, index, all) => (
            <span key={crumb.path} className="flex items-center gap-0.5">
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-faint">
                  /
                </span>
              )}
              <button
                type="button"
                aria-current={index === all.length - 1 ? "location" : undefined}
                onClick={() => onOpen(crumb.path)}
                className={cn(
                  "cursor-pointer rounded-sm px-1 py-0.5 outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2",
                  index === all.length - 1 ? "text-ink" : "text-muted",
                )}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      )}
      <Input
        role="combobox"
        aria-label="Filter, or type a path"
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={listed ? `${base}-list` : undefined}
        aria-activedescendant={activeDomId}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder="Filter, or type a path"
        value={query}
        className="font-mono"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {/* A tab stop, so a list that scrolls can be scrolled without a mouse. The field still takes the keys. */}
      <div tabIndex={0} className="max-h-60 min-h-24 overflow-y-auto outline-offset-2 outline-clay focus-visible:outline-2">
        {error !== null ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-3 py-6 text-center text-sm text-deny">
            <p>{error}</p>
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : loading || listing === null ? (
          <p role="status" className="px-3 py-6 text-center text-sm text-muted">
            loading…
          </p>
        ) : listed ? (
          <div id={`${base}-list`} role="listbox" aria-label="Folders" className="flex flex-col gap-0.5">
            {shown.map((entry, index) => (
              <div
                key={entry.path}
                id={optionId(index)}
                role="option"
                aria-selected={entry === active}
                // Focus stays in the field, so a press must not take it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onOpen(entry.path)}
                className="flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 aria-selected:bg-sunken aria-selected:ring-1 aria-selected:ring-line-strong"
              >
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.git ? <span className="rounded-full border border-line px-1.5 font-mono text-xs text-faint">git</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted">{query === "" || typing ? "No folders here." : "No matching folders."}</p>
        )}
        {listing?.truncated === true && error === null ? (
          <p className="px-3 py-2 text-xs text-muted">Showing the first 500 folders. Type to narrow.</p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" kind="primary" disabled={listing === null || error !== null} onClick={() => listing !== null && onPick(listing.path)}>
          Use this folder
        </Button>
      </div>
    </div>
  );
}

export type FolderBrowserProps = {
  /** Where it opens: this folder if it is under home, else home. */
  initialPath: string | null;
  /** A folder was chosen: the one shown, or a path typed that is outside home. */
  onPick: (path: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
};

/**
 * Browse the home folder for a folder. It knows nothing of what the folder is for: the caller
 * takes the pick. A path typed outside home is handed over as typed, with no listing.
 */
export function FolderBrowser({ initialPath, onPick, onCancel, autoFocus }: FolderBrowserProps) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [moved, setMoved] = useState(false);
  const [query, setQuery] = useState("");
  const first = useDirs(path);
  // The folder it was asked to open may be outside home, or gone: then it opens at home instead.
  const fallback = !moved && path !== null && first.isError;
  const home = useDirs(null, fallback);
  const dirs = fallback ? home : first;
  const listing = dirs.data ?? null;

  function go(to: string | null): void {
    setMoved(true);
    setQuery("");
    setPath(to);
  }

  function goTyped(text: string): void {
    const typed = resolveTyped(text, listing?.home ?? null);
    if (typed === null) return;
    if (listing !== null && !underHome(typed, listing.home)) {
      onPick(typed);
      return;
    }
    go(typed);
  }

  return (
    <FolderBrowserView
      listing={dirs.isError ? null : listing}
      loading={dirs.isPending}
      error={dirs.isError ? dirs.error.message : null}
      query={query}
      onQueryChange={setQuery}
      onOpen={go}
      onUp={() => go(dirs.isError ? null : (listing?.parent ?? null))}
      onGoTyped={goTyped}
      onRetry={() => void dirs.refetch()}
      onPick={onPick}
      onCancel={onCancel}
      autoFocus={autoFocus}
    />
  );
}
