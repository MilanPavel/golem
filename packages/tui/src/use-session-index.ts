import { useEffect, useRef, useState } from "react";
import { mergeSummary, type GolemClient, type SessionSummary } from "@golem/client";

/**
 * Every session, newest activity first, kept current by `session.summary`.
 *
 * Watching starts on the first connect. After a reconnect the client lists and
 * watches again by itself.
 */
export function useSessionIndex(client: GolemClient, connected: boolean): readonly SessionSummary[] {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const watching = useRef(false);

  useEffect(() => {
    return client.onSessionSummary((summary) => {
      setSessions((current) => mergeSummary(current, summary));
    });
  }, [client]);

  useEffect(() => {
    if (!connected || watching.current) {
      return;
    }
    watching.current = true;
    void client.watchSessions().catch(() => {
      watching.current = false;
    });
  }, [client, connected]);

  return sessions;
}
