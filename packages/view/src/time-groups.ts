/**
 * Sessions grouped by when they last changed: Today, Yesterday, Previous 7 days, Earlier. Pure
 * and given the time, so the web and the terminal say the same thing.
 */

export type TimeGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";

export interface TimeGroup<T> {
  label: TimeGroupLabel;
  items: T[];
}

const LABELS: readonly TimeGroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Earlier"];

/**
 * Group `items` by `updated_at` in local time. Today starts at this morning's midnight, Yesterday
 * at the midnight before it, Previous 7 days at the midnight seven days before today's (so the
 * days 2 to 7 back), and Earlier is the rest. Days are counted with calendar dates, so a day with
 * a clock change is right.
 *
 * Groups come in that order and empty ones are left out. Inside a group the newest comes first,
 * and items with the same time keep their order. A date that does not parse goes to Earlier; one
 * in the future goes to Today. The items themselves are not copied or changed.
 */
export function groupByTime<T extends { updated_at: string }>(
  items: readonly T[],
  now: number | Date,
): TimeGroup<T>[] {
  const at = new Date(now);
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const yesterday = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1).getTime();
  const week = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 7).getTime();

  const buckets: T[][] = [[], [], [], []];
  const times = new Map<T, number>();
  for (const item of items) {
    const parsed = Date.parse(item.updated_at);
    const time = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    times.set(item, time);
    const index = time >= today ? 0 : time >= yesterday ? 1 : time >= week ? 2 : 3;
    buckets[index]!.push(item);
  }

  const groups: TimeGroup<T>[] = [];
  LABELS.forEach((label, index) => {
    const list = buckets[index]!;
    if (list.length === 0) {
      return;
    }
    // Array.prototype.sort is stable, so equal times keep their input order. Compare instead of
    // subtracting: two bad dates are both -Infinity and would give NaN.
    list.sort((a, b) => {
      const x = times.get(a)!;
      const y = times.get(b)!;
      return x === y ? 0 : y > x ? 1 : -1;
    });
    groups.push({ label, items: list });
  });
  return groups;
}
