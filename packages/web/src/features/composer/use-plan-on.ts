import { useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";

const selectOn = ({ chat }: SessionView) => chat.plan.on;

/** Whether a session is in plan first. */
export function usePlanOn(sessionId: string): boolean {
  return useSession(sessionId, selectOn);
}
