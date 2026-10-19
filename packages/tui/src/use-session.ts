import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GolemClient } from "@golem/client";

import { openLatest, openNew, openOne, type SessionOpener } from "./session-open.ts";

export type SessionCallbacks = {
  /** The TUI now follows `sessionId`. Clear what belonged to the previous one. */
  onSwitch: (sessionId: string) => void;
  onError: (error: unknown) => void;
};

export type SessionHandle = {
  readonly id: string | null;
  /** The followed session, readable from event listeners without a render. */
  readonly ref: RefObject<string | null>;
  /** Leave the current session and start a fresh one. */
  startNew: () => void;
  /** Leave the current session and follow `sessionId`. */
  switchTo: (sessionId: string) => void;
};

/**
 * The session this TUI follows.
 *
 * On the first connect it attaches to the session with the newest activity.
 * After a reconnect the client attaches again by itself, so nothing reopens.
 */
export function useSession(
  client: GolemClient,
  connected: boolean,
  cwd: string,
  callbacks: SessionCallbacks,
): SessionHandle {
  const [id, setId] = useState<string | null>(null);
  const ref = useRef<string | null>(null);
  const opening = useRef(false);
  const latest = useRef(callbacks);
  latest.current = callbacks;

  const open = useCallback(
    async (how: typeof openLatest): Promise<void> => {
      if (opening.current) {
        return;
      }
      opening.current = true;
      const previous = ref.current;
      try {
        const opener: SessionOpener = {
          listSessions: (limit) => client.listSessions(limit),
          attachSession: (sessionId, afterSeq) => client.attachSession(sessionId, afterSeq),
          createSession: () => client.createSession({ cwd }),
        };
        await how(opener, (sessionId) => {
          ref.current = sessionId;
          setId(sessionId);
          latest.current.onSwitch(sessionId);
        });
        if (previous !== null && previous !== ref.current) {
          void client.detachSession(previous).catch(() => undefined);
        }
      } catch (error: unknown) {
        ref.current = null;
        setId(null);
        latest.current.onError(error);
      } finally {
        opening.current = false;
      }
    },
    [client, cwd],
  );

  useEffect(() => {
    if (connected && ref.current === null) {
      void open(openLatest);
    }
  }, [connected, open]);

  const startNew = useCallback(() => {
    void open(openNew);
  }, [open]);

  const switchTo = useCallback(
    (sessionId: string) => {
      if (sessionId !== ref.current) {
        void open((opener, choose) => openOne(opener, sessionId, choose));
      }
    },
    [open],
  );

  return { id, ref, startNew, switchTo };
}
