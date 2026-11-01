const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** How long ago: `now`, `2m`, `3h`, `5d`, then a short date. An unreadable time gives an empty string. */
export function timeAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const age = now - then;
  if (age < MINUTE) {
    return "now";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h`;
  }
  if (age < WEEK) {
    return `${Math.floor(age / DAY)}d`;
  }
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return new Date(then).toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
