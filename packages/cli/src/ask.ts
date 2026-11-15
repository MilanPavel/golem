import { resolve } from "node:path";

import type { ChatEvent, SendOptions } from "@golem/client";

/** Exit code of `golem ask` when the run stops on an approval and `--detach` was not given. */
export const EXIT_APPROVAL = 3;

export interface AskArgs {
  prompt: string;
  /** Absolute path, or undefined for the current folder. */
  folder?: string;
  model?: string;
  skill?: string;
  detach: boolean;
}

export type AskParse = { kind: "ask"; args: AskArgs } | { kind: "error"; message: string };

const ASK_USAGE = 'usage: golem ask "<prompt>" [--folder <dir>] [--model <profile>] [--skill <name>] [--detach]';

/** `golem ask "<prompt>" [--folder D] [--model P] [--skill S] [--detach]`. */
export function parseAskArgs(given: string[]): AskParse {
  const fail = (message: string): AskParse => ({ kind: "error", message });
  let prompt: string | undefined;
  let folder: string | undefined;
  let model: string | undefined;
  let skill: string | undefined;
  let detach = false;
  for (let i = 0; i < given.length; i += 1) {
    const arg = given[i] as string;
    if (arg === "--detach") {
      if (detach) return fail(ASK_USAGE);
      detach = true;
    } else if (arg === "--folder" || arg === "--model" || arg === "--skill") {
      const value = given[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) return fail(`${arg} needs a value\n${ASK_USAGE}`);
      i += 1;
      if (arg === "--folder" && folder === undefined) folder = resolve(value);
      else if (arg === "--model" && model === undefined) model = value;
      else if (arg === "--skill" && skill === undefined) skill = value;
      else return fail(ASK_USAGE);
    } else if (arg.startsWith("--") || prompt !== undefined) {
      return fail(ASK_USAGE);
    } else {
      prompt = arg;
    }
  }
  if (prompt === undefined || prompt.trim() === "") return fail(ASK_USAGE);
  const args: AskArgs = { prompt, detach };
  if (folder !== undefined) args.folder = folder;
  if (model !== undefined) args.model = model;
  if (skill !== undefined) args.skill = skill;
  return { kind: "ask", args };
}

/** What `golem ask` needs from the client: a fake stands in for it in the tests. */
export interface AskClient {
  createSession(options: { cwd?: string; modelProfile?: string; origin?: "cli" }): Promise<{ session_id: string }>;
  attachSession(sessionId: string, afterSeq?: number): Promise<unknown>;
  onEvent(listener: (event: ChatEvent) => void): () => void;
  sendMessage(sessionId: string, text: string, options?: SendOptions): Promise<unknown>;
}

export interface AskOut {
  out(text: string): void;
  err(text: string): void;
}

/** The lines a run that stops on an approval prints, with how to answer it. */
export function formatApproval(sessionId: string, data: { name: string; subject?: string | null }): string[] {
  const what = data.subject === undefined || data.subject === null ? data.name : `${data.name}: ${data.subject}`;
  return [`golem is asking before it runs ${what}`, `Answer it with: golem open ${sessionId}`];
}

/**
 * Starts a session with origin `cli` and sends the prompt.
 * With `detach` it prints the session id and returns. Otherwise it waits for the run: the answer on stdout and 0,
 * or the question and how to answer it on stderr and 3 when the run stops on an approval, or 1 when it fails.
 */
export async function runAsk(client: AskClient, args: AskArgs, io: AskOut, cwd: string = process.cwd()): Promise<number> {
  const options: { cwd: string; modelProfile?: string; origin: "cli" } = { cwd: args.folder ?? cwd, origin: "cli" };
  if (args.model !== undefined) options.modelProfile = args.model;
  const { session_id: sessionId } = await client.createSession(options);
  const send = (): Promise<unknown> =>
    args.skill === undefined
      ? client.sendMessage(sessionId, args.prompt)
      : client.sendMessage(sessionId, `/${args.skill} ${args.prompt}`, { skill: { name: args.skill, args: args.prompt } });
  if (args.detach) {
    await send();
    io.out(`${sessionId}\n`);
    return 0;
  }

  let answer: string | null = null;
  let failure: string | null = null;
  let finish: (code: number) => void = () => undefined;
  const done = new Promise<number>((resolveDone) => {
    finish = resolveDone;
  });
  const stop = client.onEvent((event) => {
    if (event.session_id !== sessionId) return;
    const data = event.data as unknown as Record<string, unknown>;
    if (event.type === "message.completed" && data["role"] === "assistant" && data["interrupted"] !== true) {
      answer = String(data["text"]);
    } else if (event.type === "run.failed") {
      failure = String(data["message"]);
    } else if (event.type === "approval.needed") {
      const subject = data["subject"];
      const lines = formatApproval(sessionId, { name: String(data["name"]), subject: typeof subject === "string" ? subject : null });
      io.err(`${lines.join("\n")}\n`);
      finish(EXIT_APPROVAL);
    } else if (event.type === "session.completed") {
      if (data["status"] === "completed") {
        const summary = data["summary"];
        const text = answer ?? (typeof summary === "string" ? summary : "");
        io.out(text.endsWith("\n") || text === "" ? text : `${text}\n`);
        finish(0);
      } else {
        io.err(`${failure ?? `the run ${String(data["status"])}`}\nsession: ${sessionId}\n`);
        finish(1);
      }
    }
  });
  try {
    // Attach first, so no event of the run is missed.
    await client.attachSession(sessionId);
    await send();
    return await done;
  } finally {
    stop();
  }
}

export interface OpenArgs {
  sessionId: string;
  web: boolean;
}

/** `golem open <id> [--web]`, or null for anything else. */
export function parseOpenArgs(given: string[]): OpenArgs | null {
  const ids = given.filter((arg) => !arg.startsWith("--"));
  const flags = given.filter((arg) => arg.startsWith("--"));
  const id = ids[0];
  if (ids.length !== 1 || id === undefined || id === "") return null;
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--web")) return null;
  return { sessionId: id, web: flags.length === 1 };
}

/** The page of a session on the gateway, as the web app routes it. */
export function sessionPath(sessionId: string): string {
  return `/s/${encodeURIComponent(sessionId)}`;
}
