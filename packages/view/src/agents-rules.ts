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

/** A piece of a tile line: plain text, or a number (`changed` when it is not the one golem ships). */
export interface TilePart {
  text: string;
  number?: boolean;
  changed?: boolean;
}

export interface ReasonTile {
  key: "fit" | "parallel" | "model";
  title: string;
  line: TilePart[];
  note: string;
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

function num(text: string, from: DelegateNumber): TilePart {
  return { text, number: true, changed: !from.is_default };
}

/**
 * The three reasons "When needed" lists, with the four numbers in them. The wording says what golem
 * suggests to the model: the numbers shape the prompt and never stop a helper.
 */
export function reasonTiles(delegate: DelegateNumbers): ReasonTile[] {
  return [
    {
      key: "fit",
      title: "It would not fit",
      line: [
        { text: "golem suggests a helper when the reading is over " },
        num(formatShare(delegate.read_share.value), delegate.read_share),
        { text: " of the window, or the window is already " },
        num(formatShare(delegate.fill_share.value), delegate.fill_share),
        { text: " full." },
      ],
      note: "Any model.",
    },
    {
      key: "parallel",
      title: "Jobs can run at once",
      line: [
        { text: "golem suggests several when there are two or more separate jobs, each at least " },
        num(formatShare(delegate.job_share.value), delegate.job_share),
        { text: " of the window." },
      ],
      note: "Cloud models. Local helpers take turns.",
    },
    {
      key: "model",
      title: "Another model suits it",
      line: [
        { text: "golem suggests moving a large read to a model " },
        num(formatRatio(delegate.price_ratio.value), delegate.price_ratio),
        { text: " cheaper, and one hard question to a stronger model." },
      ],
      note: "Needs a second model that is ready.",
    },
  ];
}

/**
 * The line under the tiles. The daemon does not say where a number came from, so without a measurement
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
