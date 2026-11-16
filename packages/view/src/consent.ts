import type { ConsentChoice } from "@golem/client";

import type { PendingConsent } from "./chat-state.ts";
import { formatCost } from "./cost.ts";

/** The title of the paid step-up question, in the web card and the TUI band. */
export const CONSENT_TITLE = "Use a paid model for this?";

/** The label of each answer, in the order they are offered. */
export const CONSENT_LABELS: Readonly<Record<ConsentChoice, string>> = {
  session: "Allow for this session",
  once: "Just this once",
  local: "Stay local",
};

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
