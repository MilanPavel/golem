/** One number of `[agents.delegate]`, as the daemon reports it. */
export interface DelegateNumber {
  value: number;
  default: number;
  is_default: boolean;
}

/** The four numbers that shape when golem suggests a helper. */
export interface DelegateNumbers {
  read_share: DelegateNumber;
  fill_share: DelegateNumber;
  job_share: DelegateNumber;
  price_ratio: DelegateNumber;
}

/** A measurement whose numbers are in use: when it ran (a day, already formatted) and with which model. */
export interface RulesMeasurement {
  date: string;
  model: string;
}

/** A piece of a When line: plain text, or a number (`changed` when it is not the one golem ships, with `tag` saying what that is). */
export interface TilePart {
  text: string;
  number?: boolean;
  changed?: boolean;
  /** The small note after a changed number, such as `default 85%`. */
  tag?: string;
}

/** One bar of a block's picture of the window: the share of the bar that is filled, in one or more segments. */
export interface ReasonBar {
  label: string;
  /** Each segment as a share of the bar, 0 to 1. */
  parts: number[];
}

export interface ReasonTile {
  key: "fit" | "parallel" | "model";
  title: string;
  /** The When line, with the numbers as parts. */
  when: TilePart[];
  /** The Then line. */
  then: string;
  /** Where it works. */
  note: string;
  /** The picture of the window, as bars. It only repeats the numbers in the When line. */
  bars: ReasonBar[];
}

export interface RulesFoot {
  kind: "guess" | "changed" | "measured";
  /** The small label before the line, such as FIRST GUESS. */
  tag: string;
  text: string;
}

/** A share of the window as a percent, such as `30%`. */
export function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** A price ratio such as `3×` or `2.5×`. */
export function formatRatio(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}×`;
}

function num(from: DelegateNumber, format: (value: number) => string): TilePart {
  const part: TilePart = { text: format(from.value), number: true, changed: !from.is_default };
  if (!from.is_default) part.tag = `default ${format(from.default)}`;
  return part;
}

/** A share kept between 0 and 1, so a bar never leaves its track. */
function share(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * The three reasons "When needed" lists, each as a When line with the four numbers, a Then line, and the bars that
 * picture the numbers. The numbers shape the prompt and never stop a helper.
 */
export function reasonTiles(delegate: DelegateNumbers): ReasonTile[] {
  const job = share(delegate.job_share.value);
  return [
    {
      key: "fit",
      title: "Too much to read",
      when: [
        { text: "A job needs to read more than " },
        num(delegate.read_share, formatShare),
        { text: " of the context window, or the window is already " },
        num(delegate.fill_share, formatShare),
        { text: " full." },
      ],
      then: "A helper reads it in its own window and brings back the answer.",
      note: "Any model. The \"already full\" share is checked during the chat.",
      bars: [
        { label: "one read", parts: [share(delegate.read_share.value)] },
        { label: "window full", parts: [share(delegate.fill_share.value)] },
      ],
    },
    {
      key: "parallel",
      title: "Jobs that do not depend on each other",
      when: [
        { text: "There are two or more separate jobs, and each needs at least " },
        num(delegate.job_share, formatShare),
        { text: " of the window." },
      ],
      then: "One helper per job, all at once.",
      note: "Cloud models. Local helpers take turns.",
      bars: [{ label: "two jobs", parts: [job, job] }],
    },
    {
      key: "model",
      title: "Another model fits better",
      when: [
        { text: "A large read can go to a model at least " },
        num(delegate.price_ratio, formatRatio),
        { text: " cheaper. One hard question can go to a stronger model." },
      ],
      then: "The helper runs on that model.",
      note: "Needs a second model that is ready",
      bars: [
        { label: "this model", parts: [1] },
        { label: "cheaper model", parts: [share(1 / Math.max(delegate.price_ratio.value, 1))] },
      ],
    },
  ];
}

/**
 * The line under the blocks. The daemon does not say where a number came from, so without a measurement
 * the line can only tell the first guess (all four are the shipped ones) from numbers that were changed.
 */
export function rulesFoot(delegate: DelegateNumbers, measurement: RulesMeasurement | null = null): RulesFoot {
  if (measurement !== null) {
    return { kind: "measured", tag: "MEASURED", text: `on ${measurement.date} with ${measurement.model}.` };
  }
  const all = [delegate.read_share, delegate.fill_share, delegate.job_share, delegate.price_ratio];
  if (all.every((each) => each.is_default)) {
    return { kind: "guess", tag: "FIRST GUESS", text: "These four numbers are not measured yet." };
  }
  return { kind: "changed", tag: "CHANGED", text: "These numbers are not the first guess. They are set in your config or by a measurement." };
}
