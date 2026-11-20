import { useEffect, type RefObject } from "react";
import { settingsPath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { SearchIcon } from "../../ui/icons.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Link } from "../../ui/link.tsx";
import type { SettingsMatch } from "./settings-search.ts";

/** The text with the first match of the query marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-xs bg-clay-soft px-px text-clay-ink">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** The search box at the top of the sidebar. `/` focuses it from anywhere on the page, Esc clears it, Enter opens the first result. */
export function SettingsSearchBox({
  value,
  inputRef,
  onChange,
  onEnter,
}: {
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || typing(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [inputRef]);
  return (
    <label className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 focus-within:border-clay focus-within:ring-2 focus-within:ring-clay-soft">
      <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search settings"
        placeholder="Search settings"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          } else if (event.key === "Enter") {
            event.preventDefault();
            onEnter();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
      />
      <Kbd aria-hidden="true" className="px-1 py-0 text-micro text-faint">
        /
      </Kbd>
    </label>
  );
}

const RESULT = cn(
  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft outline-offset-2 outline-clay hover:bg-surface/70 focus-visible:outline-2",
  "[&_svg]:shrink-0 [&_svg]:text-faint",
  "aria-[current=page]:bg-surface aria-[current=page]:text-ink",
);

/** What the sidebar shows while there is a query: the matching sections, or a line saying nothing matched. */
export function SettingsSearchResults({
  query,
  matches,
  section,
  onPick,
}: {
  query: string;
  matches: readonly SettingsMatch[];
  section: string;
  onPick: (match: SettingsMatch | null, href: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="px-2.5 py-3 text-sm text-muted">
        Nothing matches “{query.trim()}”. Try{" "}
        <Link
          href={settingsPath("config")}
          onNavigate={(href) => {
            onPick(null, href);
          }}
          className="text-clay-ink underline underline-offset-2"
        >
          the config file
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="mt-1.5">
      <span aria-live="polite" className="block px-2.5 py-1.5 text-meta font-medium text-faint">
        {matches.length} {matches.length === 1 ? "result" : "results"}
      </span>
      {matches.map((match) => (
        <Link
          key={match.section.id}
          href={settingsPath(match.section.id)}
          onNavigate={(href) => {
            onPick(match, href);
          }}
          aria-current={match.section.id === section ? "page" : undefined}
          className={RESULT}
        >
          <match.section.icon />
          <span className="flex min-w-0 flex-col">
            <span>
              <Highlight text={match.section.title} query={query} />
            </span>
            {match.keyword === null ? null : (
              <span className="text-meta font-normal text-muted">
                <Highlight text={match.keyword} query={query} />
              </span>
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}
