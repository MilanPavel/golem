import type { InboxPost } from "../store/routines.ts";
import { QueryRoutineForm } from "../features/data/query-routine-dialog.tsx";
import { QueryRoutineChip } from "../features/data/query-routine-chip.tsx";
import { InboxPostCard } from "../features/inbox/post-card.tsx";

const NEVER = () => new Promise<never>(() => {});
const NOTHING = () => {};

const BANK = { name: "bank", kind: "files", location: "~/Documents/bank/*.csv" };

const POSTS: readonly [string, InboxPost][] = [
  [
    "Inbox post, rows",
    {
      post_id: "ib_1",
      routine: "big-payments",
      scope: "user",
      source: "bank",
      saved: "Big payments this week",
      row_count: 2,
      columns: ["booked", "description", "paid"],
      rows: [
        ["2026-11-24", "IKEA PRAHA", 812],
        ["2026-11-22", "LETENKY.CZ", 645.3],
      ],
      at: "2026-11-27T10:00:00",
    },
  ],
  [
    "Inbox post, more rows than shown",
    {
      post_id: "ib_2",
      routine: "spending",
      scope: "user",
      source: "bank",
      saved: "Spending by month",
      row_count: 14,
      columns: ["month", "spent"],
      rows: Array.from({ length: 10 }, (_row, at) => [`2026-${String(at + 1).padStart(2, "0")}`, 2000 + at * 37]),
      at: "2026-11-27T08:00:00",
    },
  ],
  [
    "Inbox post, failed",
    {
      post_id: "ib_3",
      routine: "big-payments",
      scope: "user",
      source: "bank",
      saved: "Big payments this week",
      row_count: 0,
      columns: [],
      rows: [],
      error: 'column "amout" not found',
      at: "2026-11-27T09:00:00",
    },
  ],
];

/** The frames of the saved-queries section: the routine dialog of a saved query, the Inbox post a query routine leaves, and the chip on a query's row. */
export function QueryRoutinesFrames({ theme }: { theme: string }) {
  return (
    <>
      <div role="region" aria-label={`Routine dialog, ${theme}`} className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 text-ink">
        <QueryRoutineForm inline source={BANK} saved="Big payments this week" onCreate={NEVER} onClose={NOTHING} />
      </div>
      <div role="region" aria-label={`Routine dialog, every week and a summary, ${theme}`} className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 text-ink">
        <QueryRoutineForm inline source={BANK} saved="Spending by month" onCreate={NEVER} onClose={NOTHING} initial={{ when: "weekly", then: "summary" }} />
      </div>
      <div role="region" aria-label={`Routine dialog, new file, ${theme}`} className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 text-ink">
        <QueryRoutineForm inline source={BANK} saved="Spending by month" onCreate={NEVER} onClose={NOTHING} initial={{ when: "watch", then: "always" }} />
      </div>
      <div role="region" aria-label={`Routine dialog, failed, ${theme}`} className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 text-ink">
        <QueryRoutineForm inline source={BANK} saved="Subscriptions" onCreate={NEVER} onClose={NOTHING} initial={{ error: "There is no routine to make: the folder is not trusted." }} />
      </div>
      <div role="region" aria-label={`Chips on a query row, ${theme}`} className="flex w-full max-w-lg flex-wrap gap-2 rounded-lg border border-line bg-surface p-3 text-ink">
        <QueryRoutineChip config={{ name: "spending", schedule: "0 8 * * 1", query: { source: "bank", saved: "Spending by month" }, post: "always" }} onOpen={NOTHING} />
        <QueryRoutineChip config={{ name: "big-payments", schedule: "every 1h", query: { source: "bank", saved: "Big payments this week" }, post: "rows" }} onOpen={NOTHING} />
        <QueryRoutineChip config={{ name: "report", schedule: "0 8 * * 1", workflow: "data_report", inputs: { source: "bank", queries: "Spending by month" } }} onOpen={NOTHING} />
      </div>
      {POSTS.map(([title, post]) => (
        <ul key={title} aria-label={`${title}, ${theme}`} className="m-0 w-full max-w-lg list-none p-0">
          <InboxPostCard post={post} onOpenQuery={NOTHING} onAsk={NOTHING} onDone={NOTHING} />
        </ul>
      ))}
    </>
  );
}
