import { openPlan, type PlanState } from "@golem/view";

import type { KeyPlace } from "./keys.ts";

/** What else may hold the Enter key. */
export type OtherAsks = { retry: boolean; install: boolean; setup: boolean };

/**
 * Whether the newest plan waits for an answer and nothing else has the keys. Then Enter on an empty
 * composer means "Build it", and the hint row says so. Text in the composer is a new message instead.
 */
export function planOffered(plan: PlanState, place: KeyPlace, other: OtherAsks): boolean {
  if (openPlan(plan) === null || other.retry || other.install || other.setup) {
    return false;
  }
  return (
    place.connected &&
    place.draftEmpty &&
    !place.busy &&
    !place.overlay &&
    !place.help &&
    !place.switcher &&
    !place.debug &&
    !place.history &&
    place.approval !== true &&
    place.approvalEdit !== true &&
    !place.suggestions
  );
}
