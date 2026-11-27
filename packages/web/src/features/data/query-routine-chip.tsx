import { routineChipText, triggerWords, type RoutineConfigLike } from "@golem/view";

/** The `⏱ …` chip on a saved query's row that has a routine. Clicking it opens the routine. */
export function QueryRoutineChip({ config, onOpen }: { config: RoutineConfigLike; onOpen: (name: string) => void }) {
  const text = routineChipText(config, triggerWords(config));
  return (
    <button
      type="button"
      title={`Open the routine ${config.name}`}
      aria-label={`Open the routine ${config.name}: ${text}`}
      className="max-w-full truncate rounded-full border border-line-strong bg-surface px-2 py-0.5 text-meta text-muted outline-offset-2 outline-clay hover:border-ink focus-visible:outline-2"
      onClick={() => {
        onOpen(config.name);
      }}
    >
      {text}
    </button>
  );
}
