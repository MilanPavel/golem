import type { Suggestion } from "@golem/view";

/**
 * The slash suggestions above the composer: a listbox whose active option the textarea names with
 * `aria-activedescendant`. Focus stays in the textarea, so a press on a row must not take it.
 */
export function SuggestionList({
  id,
  optionId,
  items,
  selected,
  onPick,
}: {
  id: string;
  optionId: (index: number) => string;
  items: readonly Suggestion[];
  selected: number;
  onPick: (index: number) => void;
}) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Commands"
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-soft"
    >
      {items.map((item, index) => (
        <div
          key={item.completion}
          id={optionId(index)}
          role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
          className="flex cursor-default items-baseline gap-3 rounded-md px-3 py-1.5 aria-selected:bg-line"
        >
          <span className="shrink-0 font-mono text-sm text-clay-ink">{item.label}</span>
          <span className="min-w-0 truncate text-xs text-muted">{item.description}</span>
        </div>
      ))}
    </div>
  );
}
