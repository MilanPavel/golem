/**
 * Routines in words: a schedule as a person says it, when the next run is, how a run went, and a
 * routine as the TOML that is written in config.toml. Pure, so the web and the terminal say the
 * same thing.
 */

/** The parts of a routine's config these words read. */
export type RoutineConfigLike = {
  name: string;
  /** The text or `/skill` of a prompt routine. A workflow routine has `workflow` instead. */
  prompt?: string | null;
  workflow?: string | null;
  inputs?: Readonly<Record<string, string | number | boolean>>;
  schedule?: string | null;
  on?: { watch: string; glob?: string } | null;
  folder?: string | null;
  model?: string | null;
  mcp?: readonly string[];
  missed?: string;
  enabled?: boolean;
  notify_finished?: boolean | null;
  notify_failed?: boolean | null;
};

/** The parts of one firing these words read. */
export type RoutineRunLike = {
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";
  reason?: string | null;
  summary?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  /** The file a watch firing is for, as an absolute path. */
  watch_path?: string | null;
};

/** The parts of a listed routine these words read. */
export type RoutineLike = {
  config: RoutineConfigLike;
  next_at?: string | null;
  last?: RoutineRunLike | null;
  paused?: boolean;
  blocked?: boolean;
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"] as const;

const clock = (hour: number, minute: number): string => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

function every(count: number, unit: string): string {
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

function dayIndex(text: string): number | null {
  const named = DAY_NAMES.indexOf(text.toLowerCase().slice(0, 3) as (typeof DAY_NAMES)[number]);
  if (named >= 0 && /^[a-z]+$/i.test(text)) return named;
  if (/^[0-7]$/.test(text)) return Number(text) % 7;
  return null;
}

function cronWords(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  if (dom !== "*" || month !== "*") return null;
  const step = /^\*\/(\d+)$/.exec(minute);
  if (hour === "*" && dow === "*") {
    if (minute === "*") return "Every minute";
    if (step?.[1] !== undefined) return every(Number(step[1]), "minute");
    if (minute === "0") return "Every hour";
    return null;
  }
  if (minute === "0" && dow === "*") {
    const hours = /^\*\/(\d+)$/.exec(hour);
    if (hours?.[1] !== undefined) return every(Number(hours[1]), "hour");
  }
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  const time = clock(Number(hour), Number(minute));
  if (dow === "*") return `Daily at ${time}`;
  if (/^(1-5|mon-fri)$/i.test(dow)) return `Weekdays at ${time}`;
  const day = dayIndex(dow);
  return day === null ? null : `${DAY_PLURAL[day]} at ${time}`;
}

/**
 * A schedule as a person says it. The shorthands: `every 15m` is "Every 15 minutes", `every 1h` "Every hour",
 * `daily 08:30` "Daily at 08:30", `weekdays 08:30` "Weekdays at 08:30", `weekly mon 06:00` and `mon 06:00`
 * "Mondays at 06:00". A cron line gets the same words when it says one of those things, and is shown as
 * `Cron <line>` when it says something else.
 */
export function scheduleWords(schedule: string): string {
  const text = schedule.trim().replace(/\s+/g, " ");
  const minutes = /^every (\d+)\s*m$/i.exec(text);
  if (minutes?.[1] !== undefined) return every(Number(minutes[1]), "minute");
  const hours = /^every (\d+)\s*h$/i.exec(text);
  if (hours?.[1] !== undefined) return every(Number(hours[1]), "hour");
  const plain = /^(daily|weekdays|weekly [a-z]{3}|[a-z]{3}) (\d{1,2}):(\d{2})$/i.exec(text);
  if (plain?.[1] !== undefined && plain[2] !== undefined && plain[3] !== undefined) {
    const time = clock(Number(plain[2]), Number(plain[3]));
    const kind = plain[1].toLowerCase();
    if (kind === "daily") return `Daily at ${time}`;
    if (kind === "weekdays") return `Weekdays at ${time}`;
    const day = dayIndex(kind.split(" ").at(-1) ?? "");
    if (day !== null) return `${DAY_PLURAL[day]} at ${time}`;
  }
  return cronWords(text) ?? `Cron ${text}`;
}

/** What starts a routine, in words: its schedule, or "New *.pdf in ~/Downloads" for a watched folder. */
export function triggerWords(config: Pick<RoutineConfigLike, "schedule" | "on">): string {
  if (config.on) {
    const glob = config.on.glob ?? "*";
    return glob === "*" ? `New files in ${config.on.watch}` : `New ${glob} in ${config.on.watch}`;
  }
  return config.schedule ? scheduleWords(config.schedule) : "No schedule";
}

/** The name of a file, from its path. */
export function fileName(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

/** What the glob of a watch routine matches, in words: `*.pdf` is "PDF", no glob or `*` is "file", anything else "file matching <glob>". */
function globKind(glob: string | undefined): string {
  const text = (glob ?? "").trim();
  if (text === "" || text === "*") return "file";
  const ext = /^\*\.([A-Za-z0-9]+)$/.exec(text)?.[1];
  return ext === undefined ? `file matching ${text}` : ext.toUpperCase();
}

/**
 * The preview line of a watch routine in the editor: `Runs /receipt-to-csv for each new PDF in ~/Downloads`.
 * A prompt that is not a /skill is "Runs the prompt". Empty until a folder is picked.
 */
export function watchPreviewText(watch: string, glob: string | undefined, prompt: string): string {
  const folder = watch.trim();
  if (folder === "") return "";
  const skill = /^\/\S+/.exec(prompt.trim())?.[0];
  return `Runs ${skill ?? "the prompt"} for each new ${globKind(glob)} in ${folder}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How far off a run is: `next in 5 min`, `next in 14 h`, `next in 3 d`. A time that is past or less than a minute
 * away says "next in under a minute". An unreadable time gives an empty string.
 */
export function nextRunText(nextAt: string | null | undefined, now: number): string {
  if (nextAt === null || nextAt === undefined) return "";
  const at = Date.parse(nextAt);
  if (Number.isNaN(at)) return "";
  const away = at - now;
  if (away < MINUTE) return "next in under a minute";
  if (away < HOUR) return `next in ${Math.round(away / MINUTE)} min`;
  if (away < 2 * DAY) return `next in ${Math.round(away / HOUR)} h`;
  return `next in ${Math.round(away / DAY)} d`;
}

/** "Weekdays at 08:30 · next in 14 h": the header line of a routine. Without a next run, the trigger alone. */
export function routineHeadline(routine: RoutineLike, now: number): string {
  const trigger = triggerWords(routine.config);
  const next = nextRunText(routine.next_at, now);
  return next === "" ? trigger : `${trigger} · ${next}`;
}

const STATUS_WORDS: Record<RoutineRunLike["status"], string> = {
  queued: "queued",
  running: "running",
  waiting: "waiting for you",
  succeeded: "finished",
  failed: "failed",
  skipped: "skipped",
  cancelled: "stopped",
};

/** One word or two for a run's status: "finished", "failed", "waiting for you". */
export function runStatusWords(status: RoutineRunLike["status"]): string {
  return STATUS_WORDS[status];
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() ?? "";
}

/**
 * How a run went: the start of its reply when it finished, the reason when it failed or was skipped
 * ("skipped: paused"), and the status words otherwise.
 */
export function lastResultText(run: RoutineRunLike): string {
  const reason = run.reason ? firstLine(run.reason) : "";
  const summary = run.summary ? firstLine(run.summary) : "";
  switch (run.status) {
    case "succeeded":
      return summary === "" ? "finished" : summary;
    case "failed":
      return reason !== "" ? reason : summary !== "" ? summary : "failed";
    case "skipped":
      return reason === "" ? "skipped" : `skipped: ${reason}`;
    default:
      return STATUS_WORDS[run.status];
  }
}

/** What a routine's dot shows: off (disabled, paused or untrusted), running, waiting for you, failed, or idle. */
export type RoutineState = "off" | "running" | "waiting" | "failed" | "idle";

export function routineState(routine: RoutineLike): RoutineState {
  if (routine.blocked === true || routine.paused === true || routine.config.enabled === false) return "off";
  const status = routine.last?.status;
  if (status === "running" || status === "queued") return "running";
  if (status === "waiting") return "waiting";
  if (status === "failed") return "failed";
  return "idle";
}

/**
 * The second line of a routine's row: its trigger in words, then what to expect. A routine that is off says why,
 * one that needs you or failed says so, and any other shows when it runs next, or how the last run went.
 */
export function routineRowLine(routine: RoutineLike, now: number): string {
  const trigger = triggerWords(routine.config);
  const state = routineState(routine);
  let tail: string;
  if (routine.blocked === true) tail = "untrusted folder";
  else if (routine.paused === true) tail = "paused";
  else if (routine.config.enabled === false) tail = "off";
  else if (state === "waiting") tail = "needs you";
  else if (state === "running") tail = "running";
  else if (state === "failed") tail = "last run failed";
  else {
    const next = nextRunText(routine.next_at, now);
    tail = next !== "" ? next : routine.last ? lastResultText(routine.last) : "watching";
  }
  return `${trigger} · ${tail}`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** When a run started, for a History row: `Today 08:30`, `Yesterday 08:30`, then `Tue 10 Nov`. Local time. Empty when unreadable. */
export function runWhenText(iso: string | null | undefined, now: number): string {
  if (iso === null || iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const midnight = (time: Date): number => new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(at)) / DAY);
  if (days === 0) return `Today ${clock(at.getHours(), at.getMinutes())}`;
  if (days === 1) return `Yesterday ${clock(at.getHours(), at.getMinutes())}`;
  return `${DAY_NAMES[at.getDay()]?.replace(/^./, (c) => c.toUpperCase())} ${at.getDate()} ${MONTH_SHORT[at.getMonth()]}`;
}

const quote =(text: string): string => JSON.stringify(text);

/** A routine as the `[[routine]]` table that holds it in config.toml. Only what is set, and the prompt last. */
export function routineToml(config: RoutineConfigLike): string {
  const lines = ["[[routine]]", `name = ${quote(config.name)}`];
  if (config.schedule) lines.push(`schedule = ${quote(config.schedule)}`);
  if (config.on) {
    lines.push(`on = { watch = ${quote(config.on.watch)}, glob = ${quote(config.on.glob ?? "*")} }`);
  }
  if (config.folder) lines.push(`folder = ${quote(config.folder)}`);
  if (config.model) lines.push(`model = ${quote(config.model)}`);
  if (config.mcp && config.mcp.length > 0) lines.push(`mcp = [${config.mcp.map(quote).join(", ")}]`);
  if (config.missed) lines.push(`missed = ${quote(config.missed)}`);
  if (config.enabled === false) lines.push("enabled = false");
  if (config.notify_finished !== null && config.notify_finished !== undefined) lines.push(`notify_finished = ${config.notify_finished}`);
  if (config.notify_failed !== null && config.notify_failed !== undefined) lines.push(`notify_failed = ${config.notify_failed}`);
  if (config.workflow) {
    lines.push(`workflow = ${quote(config.workflow)}`);
    const inputs = Object.entries(config.inputs ?? {});
    if (inputs.length > 0) lines.push(`inputs = { ${inputs.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }`);
    return lines.join("\n");
  }
  const prompt = config.prompt ?? "";
  lines.push(prompt.includes("\n") ? `prompt = """\n${prompt.replaceAll("\\", "\\\\").replaceAll('"""', '\\"""')}\n"""` : `prompt = ${quote(prompt)}`);
  return lines.join("\n");
}

/** The ways the builder offers: five schedules, and a new file in a folder (which has no schedule). */
export type WhenKind = "daily" | "weekdays" | "weekly" | "hours" | "cron" | "watch";

/** What the builder holds: the kind, and the field of each kind. `hours` is text so it can be typed. `day` is 0 for Sunday. */
export type RoutineWhen = { kind: WhenKind; time: string; day: number; hours: string; cron: string };

export const WHEN_KINDS: readonly { kind: WhenKind; label: string }[] = [
  { kind: "daily", label: "Every day" },
  { kind: "weekdays", label: "Weekdays" },
  { kind: "weekly", label: "Weekly" },
  { kind: "hours", label: "Every N hours" },
  { kind: "cron", label: "Cron" },
  { kind: "watch", label: "On new file" },
];

/** The days of the Weekly picker, Monday first, with the cron number of each. */
export const WEEK_DAYS: readonly { day: number; label: string }[] = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

/** A new routine starts on weekdays at 08:30. */
export const DEFAULT_WHEN: RoutineWhen = { kind: "weekdays", time: "08:30", day: 1, hours: "1", cron: "" };

function timeParts(time: string): [number, number] | null {
  const found = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (found?.[1] === undefined || found[2] === undefined) return null;
  const hour = Number(found[1]);
  const minute = Number(found[2]);
  return hour < 24 && minute < 60 ? [hour, minute] : null;
}

/**
 * The `schedule` the builder writes: a cron line for a time of day (`30 8 * * 1-5` for weekdays at 08:30),
 * `every 2h` for every N hours, and the cron text as typed. Null for a new file, which has no schedule, and when a field is not filled in. The daemon
 * checks the rest, and says what is wrong.
 */
export function whenToSchedule(when: RoutineWhen): string | null {
  if (when.kind === "watch") return null;
  if (when.kind === "cron") return when.cron.trim() === "" ? null : when.cron.trim().replace(/\s+/g, " ");
  if (when.kind === "hours") return /^\d+$/.test(when.hours.trim()) && Number(when.hours) >= 1 ? `every ${Number(when.hours)}h` : null;
  const parts = timeParts(when.time);
  if (parts === null) return null;
  const [hour, minute] = parts;
  const days = when.kind === "daily" ? "*" : when.kind === "weekdays" ? "1-5" : String(when.day);
  return `${minute} ${hour} * * ${days}`;
}

/**
 * The builder's fields for a schedule that is already written: `weekdays 08:30` and `30 8 * * 1-5` are both
 * Weekdays at 08:30. A line that is none of the builder's kinds is Cron, as written.
 */
export function scheduleToWhen(schedule: string | null | undefined): RoutineWhen {
  const text = (schedule ?? "").trim().replace(/\s+/g, " ");
  if (text === "") return { ...DEFAULT_WHEN };
  const cron: RoutineWhen = { ...DEFAULT_WHEN, kind: "cron", cron: text };
  const hours = /^every (\d+)\s*h$/i.exec(text);
  if (hours?.[1] !== undefined) return { ...DEFAULT_WHEN, kind: "hours", hours: String(Number(hours[1])) };
  const plain = /^(daily|weekdays|weekly [a-z]{3}|[a-z]{3}) (\d{1,2}):(\d{2})$/i.exec(text);
  if (plain?.[1] !== undefined && plain[2] !== undefined && plain[3] !== undefined) {
    const time = clock(Number(plain[2]), Number(plain[3]));
    const kind = plain[1].toLowerCase();
    if (kind === "daily" || kind === "weekdays") return { ...DEFAULT_WHEN, kind, time };
    const day = dayIndex(kind.split(" ").at(-1) ?? "");
    return day === null ? cron : { ...DEFAULT_WHEN, kind: "weekly", time, day };
  }
  const fields = text.split(" ");
  if (fields.length !== 5) return cron;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  if (dom !== "*" || month !== "*" || !/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return cron;
  const time = clock(Number(hour), Number(minute));
  if (timeParts(time) === null) return cron;
  if (dow === "*") return { ...DEFAULT_WHEN, kind: "daily", time };
  if (/^(1-5|mon-fri)$/i.test(dow)) return { ...DEFAULT_WHEN, kind: "weekdays", time };
  const day = dayIndex(dow);
  return day === null ? cron : { ...DEFAULT_WHEN, kind: "weekly", time, day };
}

/** The `on` a watch routine saves: the folder, and the glob when there is one (left out, it is `*`). Null while no folder is named. */
export function watchToOn(folder: string, glob: string): { watch: string; glob?: string } | null {
  const watch = folder.trim();
  if (watch === "") return null;
  const pattern = glob.trim();
  return pattern === "" ? { watch } : { watch, glob: pattern };
}

/**
 * The daemon's next times of a schedule as one line, in local time: `Next: Mon 08:30 · Tue 08:30 · Wed 08:30`.
 * A time a week or more away also says its date. A time that cannot be read is left out.
 */
export function nextTimesText(times: readonly string[], now: number): string {
  const midnight = (time: Date): number => new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const words: string[] = [];
  for (const iso of times) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    const day = DAY_NAMES[at.getDay()]?.replace(/^./, (c) => c.toUpperCase()) ?? "";
    const far = Math.round((midnight(at) - midnight(new Date(now))) / DAY) >= 7;
    words.push(`${day}${far ? ` ${at.getDate()} ${MONTH_SHORT[at.getMonth()]}` : ""} ${clock(at.getHours(), at.getMinutes())}`);
  }
  return words.length === 0 ? "" : `Next: ${words.join(" · ")}`;
}
