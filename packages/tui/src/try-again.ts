import type { GolemClient } from "@golem/client";
import { tryAnswer, type TryPlan, type TryRun } from "@golem/view";

import { markdownLines } from "./layout-chat.ts";

/** The calls a try makes. The app's client has them all. */
export type TryClient = Pick<
  GolemClient,
  | "forkSession"
  | "createSession"
  | "renameSession"
  | "setSessionOptions"
  | "attachSession"
  | "detachSession"
  | "sendMessage"
  | "cancelRun"
>;

export type TrySource = {
  /** The chat's session. A try never sends to it. */
  sessionId: string;
  cwd: string | undefined;
  profile: string | undefined;
};

/**
 * Ask the question again in a fork of the chat: fork before the question, name it, set the panel's
 * options on it, then send the question, with the fork attached so its events arrive. The fork is
 * kept as a session. A question that is the first message has nothing to fork at, so it starts a
 * new session in the same folder with the same model profile.
 *
 * `onStarted` gets the fork's id before anything is attached, so no event of it is missed.
 */
export async function startTry(
  client: TryClient,
  plan: Extract<TryPlan, { kind: "try" }>,
  source: TrySource,
  title: string,
  onStarted: (sessionId: string) => void,
): Promise<string> {
  let forkId: string;
  if (plan.forkAt === null) {
    const created = await client.createSession({
      ...(source.cwd === undefined ? {} : { cwd: source.cwd }),
      ...(source.profile === undefined ? {} : { modelProfile: source.profile }),
    });
    forkId = created.session_id;
  } else {
    forkId = (await client.forkSession(source.sessionId, plan.forkAt)).session_id;
  }
  onStarted(forkId);
  await client.attachSession(forkId);
  await client.renameSession(forkId, title);
  await client.setSessionOptions(forkId, plan.options);
  await client.sendMessage(forkId, plan.text);
  return forkId;
}

/** Stop a try's run if it is going, and stop watching its fork. The session stays. */
export function dropTry(client: TryClient, runId: string | null, sessionId: string): void {
  if (runId !== null) {
    void client.cancelRun(runId).catch(() => undefined);
  }
  void client.detachSession(sessionId).catch(() => undefined);
}

export type TryLine = { text: string; dim: boolean };

/** The block under the panel: the heading, one dim line of the original answer, then the reply. */
export function tryLines(run: TryRun, columns: number): TryLine[] {
  const width = Math.max(1, columns);
  const lines: TryLine[] = [{ text: cut(` ${run.heading}`, width), dim: false }];
  if (run.original !== null) {
    lines.push({ text: cut(` was: ${run.original}`, width), dim: true });
  }
  const answer = tryAnswer(run);
  if (answer === null) {
    lines.push({ text: " …", dim: true });
    return lines;
  }
  const body = answer.text === "" ? [] : markdownLines(answer.text, Math.max(1, width - 1));
  for (const spans of body) {
    lines.push({ text: cut(` ${spans.map((span) => span.text).join("")}`, width), dim: false });
  }
  if (answer.error !== null) {
    lines.push({ text: cut(` ${answer.error}`, width), dim: true });
  } else if (answer.streaming && body.length === 0) {
    lines.push({ text: " …", dim: true });
  }
  return lines;
}

function cut(text: string, width: number): string {
  if (text.length <= width) return text;
  return width === 1 ? "…" : `${text.slice(0, width - 1)}…`;
}
