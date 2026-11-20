import {
  CONSENT_LABELS,
  CONSENT_TITLE,
  consentAnswers,
  consentCapsLine,
  consentLine,
  consentNotSentLine,
  consentReason,
  consentSentLine,
  type ConsentChoice,
  type PendingConsent,
} from "@golem/view";

/** The key that gives each answer of the paid question. */
export const CONSENT_KEYS: Readonly<Record<ConsentChoice, string>> = { session: "a", once: "o", local: "l" };

export type ConsentLine = { text: string; bold?: boolean; dim?: boolean; tone?: "question" };

/**
 * Rows the band wants: the title, why, the model line, what is sent and not sent for a helper's question, the
 * caps line when there is one, and the keys.
 */
export function consentRows(consent: PendingConsent): number {
  return consentLines(consent, 1_000).length;
}

/**
 * The paid step-up question above the composer, one line per row. A helper's question names the helper on the
 * first line and says what is sent and not sent. `pager` (`1 of 2 · tab next`) ends the keys line.
 */
export function consentLines(consent: PendingConsent, columns: number, pager: string | null = null): ConsentLine[] {
  const width = Math.max(1, columns);
  const caps = consentCapsLine(consent);
  const keys = consentAnswers(consent)
    .map((answer) => `${CONSENT_KEYS[answer]} ${CONSENT_LABELS[answer].toLowerCase()}`)
    .concat(pager === null ? [] : [pager])
    .join(" · ");
  const sent = [consentSentLine(consent), consentNotSentLine(consent)].filter((line) => line !== "");
  const title = consent.helper === null ? CONSENT_TITLE : `${consent.helper} asks · ${CONSENT_TITLE}`;
  return [
    { text: fit(title, width), bold: true, tone: "question" },
    { text: fit(consentReason(consent), width) },
    { text: fit(consentLine(consent), width) },
    ...sent.map((line) => ({ text: fit(line, width) })),
    ...(caps === "" ? [] : [{ text: fit(caps, width), dim: true }]),
    { text: fit(keys, width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
