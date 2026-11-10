import { useEffect, useId, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cn } from "./cn.ts";
import { Input } from "./input.tsx";

/** What the list needs to know of an item. The group is its section's visible heading. */
export type SearchListItem = { id: string; group: string };

const PAGE = 10;

/** The item that is active: the one `activeId` names, else the first. It keeps its place while the list changes. */
export function resolveActive<T extends SearchListItem>(items: readonly T[], activeId: string | null): T | null {
  return items.find((item) => item.id === activeId) ?? items[0] ?? null;
}

export type SearchListProps<T extends SearchListItem> = {
  /** In display order. Items of one group are next to each other. */
  items: readonly T[];
  /** The accessible name of the search field. */
  label: string;
  placeholder?: string;
  query: string;
  onQueryChange: (query: string) => void;
  activeId: string | null;
  onActiveChange: (id: string) => void;
  /** Enter on the active item, or a double click on one. */
  onActivate: (item: T) => void;
  renderItem: (item: T, state: { active: boolean }) => ReactNode;
  /** Shown instead of the list when there is no item. */
  empty: ReactNode;
  /** Scrolls with the list, after it. */
  after?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  /** Classes of the scrolling area. */
  listClassName?: string;
};

type Section<T> = { group: string; items: { item: T; index: number }[] };

function sections<T extends SearchListItem>(items: readonly T[]): Section<T>[] {
  const out: Section<T>[] = [];
  items.forEach((item, index) => {
    const last = out.at(-1);
    if (last !== undefined && last.group === item.group) {
      last.items.push({ item, index });
    } else {
      out.push({ group: item.group, items: [{ item, index }] });
    }
  });
  return out;
}

/**
 * A search field over a grouped list. It is one combobox: focus stays in the field while the
 * arrow keys move the active option, and Enter or a double click picks it. The page that owns it
 * decides what picking means.
 */
export function SearchList<T extends SearchListItem>({
  items,
  label,
  placeholder,
  query,
  onQueryChange,
  activeId,
  onActiveChange,
  onActivate,
  renderItem,
  empty,
  after,
  inputRef,
  className,
  listClassName,
}: SearchListProps<T>) {
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (index: number) => `${base}-option-${index}`;
  const active = resolveActive(items, activeId);
  const activeIndex = active === null ? -1 : items.indexOf(active);
  const activeDomId = activeIndex < 0 ? undefined : optionId(activeIndex);

  useEffect(() => {
    if (activeDomId !== undefined) {
      document.getElementById(activeDomId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeDomId]);

  function move(to: number): void {
    const next = items[Math.min(Math.max(to, 0), items.length - 1)];
    if (next !== undefined) onActiveChange(next.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = Math.max(activeIndex, 0);
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "PageDown":
        move(at + PAGE);
        break;
      case "PageUp":
        move(at - PAGE);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "Enter":
        if (active !== null) onActivate(active);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const listed = items.length > 0;
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <Input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={listed ? listId : undefined}
        aria-activedescendant={activeDomId}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        placeholder={placeholder}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {/* A tab stop, so a list that scrolls can be scrolled without a mouse. The field still takes the keys. */}
      <div
        tabIndex={0}
        className={cn("min-h-0 overflow-y-auto outline-offset-2 outline-clay focus-visible:outline-2", listClassName)}
      >
        {listed ? (
          <div id={listId} role="listbox" aria-label={label} className="flex flex-col gap-2">
            {sections(items).map((section, at) => {
              const headingId = `${base}-group-${at}`;
              return (
                <div key={section.group} role="presentation">
                  <div id={headingId} aria-hidden="true" className="px-3 pt-1 pb-1 font-mono text-xs text-faint">
                    {section.group}
                  </div>
                  <div role="group" aria-labelledby={headingId} className="flex flex-col gap-0.5">
                    {section.items.map(({ item, index }) => {
                      const isActive = item === active;
                      return (
                        <div
                          key={item.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={isActive}
                          // Focus stays in the field, so a press must not take it.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => onActiveChange(item.id)}
                          onDoubleClick={() => onActivate(item)}
                          className="group cursor-default rounded-md px-3 py-2 aria-selected:bg-sunken aria-selected:ring-1 aria-selected:ring-line-strong"
                        >
                          {renderItem(item, { active: isActive })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          empty
        )}
        {after}
      </div>
    </div>
  );
}
