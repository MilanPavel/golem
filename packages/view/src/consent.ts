import type { ConsentChoice } from "@golem/client";

import type { PendingConsent } from "./chat-state.ts";
import { formatCost } from "./cost.ts";

/** The title of the paid step-up question, in the web card and the TUI band. */
export const CONSENT_TITLE = "Use a paid model for this?";

/** Why golem asks: the sentence of the daemon, or how the model struggles in a run. */
export function consentReason(consent: PendingConsent): string {
  if (consent.signal === null) return consent.why;
  const detail = consent.why.replace(/\.$/, "");
  return `The model is struggling: ${detail}.`;
}

/** The label of each answer, in the order they are offered. */
export const CONSENT_LABELS: Readonly<Record<ConsentChoice, string>> = {
  session: "Allow for this session",
  once: "Just this once",
  local: "Stay local",
};

/** The `local` answer of a reviewer's paid question. */
export const CONSENT_REVIEW_LOCALLY = "Review locally";

/** The label of one answer for this question: a reviewer's `local` is "Review locally", the rest keep their words. */
export function consentAnswerLabel(consent: Pick<PendingConsent, "agent">, answer: ConsentChoice): string {
  return answer === "local" && consent.agent === "reviewer" ? CONSENT_REVIEW_LOCALLY : CONSENT_LABELS[answer];
}

/** What a helper's paid question can show behind "Show": its brief and the artifact of its diff. Null when it has neither. */
export function consentShowable(
  consent: Pick<PendingConsent, "brief" | "diffArtifactId">,
): { brief: string | null; diffArtifactId: string | null } | null {
  const brief = consent.brief === undefined || consent.brief === null || consent.brief.trim() === "" ? null : consent.brief;
  const diffArtifactId = consent.diffArtifactId ?? null;
  return brief === null && diffArtifactId === null ? null : { brief, diffArtifactId };
}

/** The answers a question offers, in the order the buttons show them. */
export function consentAnswers(consent: PendingConsent): ConsentChoice[] {
  const order: ConsentChoice[] = ["session", "once", "local"];
  return order.filter((answer) => consent.alternatives.includes(answer));
}

/** `deepseek-chat · budget · ≈ $0.02 for this turn`. The estimate is left out when the price is unknown. */
export function consentLine(consent: PendingConsent): string {
  const parts = [consent.model ?? consent.modelProfile, consent.tier];
  const cost = formatCost(consent.estimatedUsd);
  if (cost !== "") parts.push(`≈ ${cost} for this turn`);
  return parts.join(" · ");
}

/** `Session cap $0.50 · today $0.42 of $2.00`. Empty when no cap is set. */
export function consentCapsLine(consent: PendingConsent): string {
  const caps = consent.caps;
  if (caps === null) return "";
  const parts: string[] = [];
  if (caps.sessionUsd !== null) parts.push(`Session cap ${formatCost(caps.sessionUsd)}`);
  if (caps.dailyUsd !== null) parts.push(`today ${formatCost(caps.spentToday)} of ${formatCost(caps.dailyUsd)}`);
  return parts.join(" · ");
}

/** `Sent: the brief, the diff` for a helper's paid question; empty when the daemon names nothing. */
export function consentSentLine(consent: Pick<PendingConsent, "sent">): string {
  return consent.sent.length === 0 ? "" : `Sent: ${consent.sent.join(", ")}`;
}

/** `Not sent: this chat`; empty when the daemon names nothing. */
export function consentNotSentLine(consent: Pick<PendingConsent, "notSent">): string {
  return consent.notSent.length === 0 ? "" : `Not sent: ${consent.notSent.join(", ")}`;
}
