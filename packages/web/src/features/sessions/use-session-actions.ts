import { useMemo } from "react";
import { useNavigate, usePageActions, useRoute } from "../../store/page-context.tsx";
import { sessionPath } from "../../store/router.ts";

export type SessionActions = {
  rename(sessionId: string, title: string): Promise<void>;
  /** Forks at a message, then opens the new session. */
  fork(sessionId: string, atMessageId: string): Promise<void>;
  /** Closes the session, then leaves its page when it is the one in view. */
  close(sessionId: string): Promise<void>;
};

/** The page's session actions with the navigation that follows each. */
export function useSessionActions(): SessionActions {
  const actions = usePageActions();
  const navigate = useNavigate();
  const route = useRoute();
  const viewing = route.name === "session" ? route.id : null;
  return useMemo(
    () => ({
      rename: (sessionId, title) => actions.rename(sessionId, title),
      async fork(sessionId, atMessageId) {
        navigate(sessionPath(await actions.fork(sessionId, atMessageId)));
      },
      async close(sessionId) {
        await actions.close(sessionId);
        if (viewing === sessionId) navigate("/");
      },
    }),
    [actions, navigate, viewing],
  );
}
