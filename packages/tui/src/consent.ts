import {
  CONSENT_TITLE,
  consentAnswerLabel,
  consentAnswers,
  consentCapsLine,
  consentLine,
  consentNotSentLine,
  consentReason,
  consentSentLine,
  consentShowable,
  type ConsentChoice,
  type PendingConsent,
} from "@golem/view";

/** The key that gives each answer of the paid question. */
export const CONSENT_KEYS: Readonly<Record<ConsentChoice, string>> = { session: "a", once: "o", local: "l" };

/** The key that shows or hides the brief of a helper's question. */
export const CONSENT_SHOW_KEY = "s";

/** The most rows the brief and the first lines of the diff take, each. */
export const SHOW_BRIEF_ROWS = 6;
export const SHOW_DIFF_ROWS = 6;

export type ConsentLine = { text: string; bold?: boolean; dim?: boolean; tone?: "question" };

/** The diff behind "show": not asked, being read, failed, or read (the text of its first page). */
export type ConsentDiff = { state: "none" } | { state: "loading" } | { state: "error" } | { state: "ready"; text: string; size: number };

/** Whether the brief is shown, and the state of its diff. */
export type ConsentShow = { open: boolean; diff: ConsentDiff };

const NOT_SHOWN: ConsentShow = { open: false, diff: { state: "none" } };

/**
 * Rows the band wants: the title, why, the model line, what is sent and not sent for a helper's question, the
 * caps line when there is one, the brief and the diff when shown, and the keys.
 */
export function consentRows(consent: PendingConsent, show: ConsentShow = NOT_SHOWN, columns = 1_000): number {
  return consentLines(consent, columns, null, show).length;
}

/** `text` cut into rows of `width` characters, at most `max`, the last one saying how many more there are. */
function wrapRows(text: string, width: number, max: number): string[] {
  const rows: string[] = [];
  for (const raw of text.replaceAll("\t", "  ").split("\n")) {
    if (raw === "") rows.push("");
    for (let at = 0; at < raw.length; at += width) rows.push(raw.slice(at, at + width));
  }
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length <= max) return rows;
  const left = rows.length - (max - 1);
  return [...rows.slice(0, max - 1), `… ${String(left)} more ${left === 1 ? "row" : "rows"}`];
}

function diffLines(diff: ConsentDiff, width: number): ConsentLine[] {
  switch (diff.state) {
    case "none":
      return [];
    case "loading":
      return [{ text: "diff: reading…", dim: true }];
    case "error":
      return [{ text: "diff: could not be read", dim: true }];
    case "ready": {
      const rows = diff.text.split("\n");
      if (rows[rows.length - 1] === "") rows.pop();
      const first = rows.slice(0, SHOW_DIFF_ROWS).map((text) => ({ text: fit(text, width), dim: true }));
      const more = rows.length > SHOW_DIFF_ROWS || diff.text.length < diff.size;
      return [{ text: "diff:" }, ...first, ...(more ? [{ text: "… the rest is in the artifact", dim: true }] : [])];
    }
  }
}

/**
 * The paid step-up question above the composer, one line per row. A helper's question names the helper on the
 * first line and says what is sent and not sent. `pager` (`1 of 2 · tab next`) ends the keys line. A helper's
 * brief and diff show behind the `s` key: `show` says whether they are open and what the diff reads.
 */
export function consentLines(consent: PendingConsent, columns: number, pager: string | null = null, show: ConsentShow = NOT_SHOWN): ConsentLine[] {
  const width = Math.max(1, columns);
  const caps = consentCapsLine(consent);
  const showable = consentShowable(consent);
  const keys = consentAnswers(consent)
    .map((answer) => `${CONSENT_KEYS[answer]} ${consentAnswerLabel(consent, answer).toLowerCase()}`)
    .concat(showable === null ? [] : [`${CONSENT_SHOW_KEY} ${show.open ? "hide" : "show"}`])
    .concat(pager === null ? [] : [pager])
    .join(" · ");
  const sent = [consentSentLine(consent), consentNotSentLine(consent)].filter((line) => line !== "");
  const title = consent.helper === null ? CONSENT_TITLE : `${consent.helper} asks · ${CONSENT_TITLE}`;
  const shown: ConsentLine[] =
    showable === null || !show.open
      ? []
      : [
          ...(showable.brief === null ? [] : [{ text: "brief:" }, ...wrapRows(showable.brief, width, SHOW_BRIEF_ROWS).map((text) => ({ text, dim: true }))]),
          ...(showable.diffArtifactId === null ? [] : diffLines(show.diff, width)),
        ];
  return [
    { text: fit(title, width), bold: true, tone: "question" },
    { text: fit(consentReason(consent), width) },
    { text: fit(consentLine(consent), width) },
    ...sent.map((line) => ({ text: fit(line, width) })),
    ...(caps === "" ? [] : [{ text: fit(caps, width), dim: true }]),
    ...shown,
    { text: fit(keys, width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
