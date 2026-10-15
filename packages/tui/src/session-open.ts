import { RpcError, SESSION_NOT_FOUND, type GolemClient } from "@golem/client";

export type SessionOpener = Pick<GolemClient, "listSessions" | "createSession" | "attachSession">;

/**
 * Attach to the session with the newest activity, or start one when there is none.
 *
 * `choose` runs before the attach, so the TUI already follows the session when
 * the replay arrives. It runs again when the newest session vanished and a new
 * one replaces it.
 */
export async function openLatest(client: SessionOpener, choose: (sessionId: string) => void): Promise<string> {
  const { sessions } = await client.listSessions(1);
  const latest = sessions[0];
  if (latest !== undefined) {
    choose(latest.session_id);
    try {
      await client.attachSession(latest.session_id);
      return latest.session_id;
    } catch (error: unknown) {
      if (!(error instanceof RpcError) || error.code !== SESSION_NOT_FOUND) {
        throw error;
      }
    }
  }
  return openNew(client, choose);
}

/** Create a session and attach to it. */
export async function openNew(client: SessionOpener, choose: (sessionId: string) => void): Promise<string> {
  const { session_id: sessionId } = await client.createSession();
  choose(sessionId);
  await client.attachSession(sessionId);
  return sessionId;
}
