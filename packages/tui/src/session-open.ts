import { RpcError, SESSION_NOT_FOUND, type GolemClient } from "@golem/client";

export type SessionOpener = Pick<GolemClient, "listSessions" | "createSession" | "attachSession">;

/**
 * Attach to the newest session in `cwd`, or start one when that folder has none.
 *
 * A session's folder never changes, so a session from another folder would
 * put the file tools somewhere the user did not start golem.
 *
 * `choose` runs before the attach, so the TUI already follows the session when
 * the replay arrives. It runs again when the newest session vanished and a new
 * one replaces it.
 */
export async function openLatest(
  client: SessionOpener,
  cwd: string,
  choose: (sessionId: string) => void,
): Promise<string> {
  const { sessions } = await client.listSessions(1, cwd);
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

/** Attach to `sessionId`, chosen in the switcher. */
export async function openOne(
  client: SessionOpener,
  sessionId: string,
  choose: (sessionId: string) => void,
): Promise<string> {
  choose(sessionId);
  await client.attachSession(sessionId);
  return sessionId;
}

/** Create a session and attach to it. */
export async function openNew(client: SessionOpener, choose: (sessionId: string) => void): Promise<string> {
  const { session_id: sessionId } = await client.createSession();
  choose(sessionId);
  await client.attachSession(sessionId);
  return sessionId;
}
