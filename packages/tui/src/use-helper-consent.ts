import type { GolemClient } from "@golem/client";
import { emptyChat, reduceChat, type ChatState, type PendingConsent } from "@golem/view";
import { useEffect, useState } from "react";

/**
 * A helper's paid question, read from the helper's own session: the pending item of the lead has no run id to
 * answer, and the session's events have it, with what is sent and not sent. Follows the session while `helperId`
 * is set and lets it go after. Null until the replay has told it.
 */
export function useHelperConsent(client: GolemClient, helperId: string | null): { sessionId: string; consent: PendingConsent } | null {
  const [state, setState] = useState<{ sessionId: string; chat: ChatState } | null>(null);
  useEffect(() => {
    if (helperId === null) {
      setState(null);
      return;
    }
    let chat = emptyChat;
    const off = client.onEvent((event) => {
      if (event.session_id !== helperId) return;
      chat = reduceChat(chat, event);
      setState({ sessionId: helperId, chat });
    });
    client.attachSession(helperId).catch(() => undefined);
    return () => {
      off();
      setState(null);
      void client.detachSession(helperId).catch(() => undefined);
    };
  }, [client, helperId]);
  return state !== null && state.sessionId === helperId && state.chat.consent !== null ? { sessionId: helperId, consent: state.chat.consent } : null;
}
