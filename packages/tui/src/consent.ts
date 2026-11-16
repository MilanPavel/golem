import {
  CONSENT_LABELS,
  CONSENT_TITLE,
  consentAnswers,
  consentCapsLine,
  consentLine,
  consentReason,
  type ConsentChoice,
  type PendingConsent,
} from "@golem/view";

/** The key that gives each answer of the paid question. */
export const CONSENT_KEYS: Readonly<Record<ConsentChoice, string>> = { session: "a", once: "o", local: "l" };

export type ConsentLine = { text: string; bold?: boolean; dim?: boolean; tone?: "question" };

/** Rows the band wants: the title, why, the model line, the caps line when there is one, and the keys. */
export function consentRows(consent: PendingConsent): number {
  return consentCapsLine(consent) === "" ? 4 : 5;
}

/** The paid step-up question above the composer, one line per row. */
export function consentLines(consent: PendingConsent, columns: number): ConsentLine[] {
  const width = Math.max(1, columns);
  const caps = consentCapsLine(consent);
  const keys = consentAnswers(consent)
    .map((answer) => `${CONSENT_KEYS[answer]} ${CONSENT_LABELS[answer].toLowerCase()}`)
    .join(" · ");
  return [
    { text: fit(CONSENT_TITLE, width), bold: true, tone: "question" },
    { text: fit(consentReason(consent), width) },
    { text: fit(consentLine(consent), width) },
    ...(caps === "" ? [] : [{ text: fit(caps, width), dim: true }]),
    { text: fit(keys, width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
