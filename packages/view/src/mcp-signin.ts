import type { McpServer, McpTestProgress, McpTestResult } from "@golem/client";

/**
 * The sign-in line under a server's name, and the steps of a token's test. Pure, so every screen
 * says the same thing.
 */

/** A secret a server names, and whether the Keychain has it (`mcp.get`'s `secrets`). */
export type SecretState = { ref: string; stored: boolean };

export type SignInLine = {
  /** `bad` is drawn in the warning colour. */
  tone: "ok" | "bad";
  /** `Token`, `Token missing`, `Token refused`, `Signed in`, `Not signed in`. */
  label: string;
  /** The Keychain name the token is kept under, when the line says so: only a token that is there. */
  ref: string | null;
  /** `worked 2 min ago`, when it is known. */
  worked: string | null;
  action: { kind: "replace" | "add" | "sign-in" | "sign-out"; label: string };
};

export type SignInInput = {
  /** The server signs in with OAuth instead of a token. */
  oauth: boolean;
  state: McpServer["state"];
  secrets: readonly SecretState[];
  /** The last connect or test was refused with 401 or 403. */
  refused: boolean;
  /** When the server last connected or passed a test, as `Date.now()` gives it, or null when not known. */
  workedAt: number | null;
  now: number;
};

/** A status of 401 or 403, or a failed connect whose error says so. */
export function isRefused(status: number | null | undefined, error: string | null | undefined): boolean {
  if (status === 401 || status === 403) return true;
  return error != null && /\bHTTP (?:401|403)\b/.test(error);
}

/** How long ago, in a few words: `just now`, `2 min ago`, `3 h ago`, `4 days ago`. */
export function agoText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The line for a server, or null when it uses no token and no sign-in. */
export function signInLine(input: SignInInput): SignInLine | null {
  if (input.oauth) {
    return input.state === "needs_auth"
      ? { tone: "bad", label: "Not signed in", ref: null, worked: null, action: { kind: "sign-in", label: "Sign in" } }
      : { tone: "ok", label: "Signed in", ref: null, worked: null, action: { kind: "sign-out", label: "Sign out" } };
  }
  if (input.secrets.some((secret) => !secret.stored)) {
    return { tone: "bad", label: "Token missing", ref: null, worked: null, action: { kind: "add", label: "Add it" } };
  }
  const first = input.secrets[0];
  if (first === undefined) return null;
  if (input.refused) {
    return { tone: "bad", label: "Token refused", ref: null, worked: null, action: { kind: "replace", label: "Replace" } };
  }
  const worked = input.workedAt === null ? null : `worked ${agoText(Math.max(0, input.now - input.workedAt))}`;
  return { tone: "ok", label: "Token", ref: first.ref, worked, action: { kind: "replace", label: "Replace" } };
}

/** One line of a token's test: what happened, and whether it passed. */
export type TokenTestRow = { text: string; ok: boolean };

type Step = Pick<McpTestProgress, "step" | "state" | "detail">;

/**
 * The steps of a token's test as a person reads them: the token is ready, then connected, signed in,
 * and the tools listed. A step that has not ended has no row, and neither has a skipped one.
 */
export function tokenTestRows(steps: readonly Step[], host: string | null): TokenTestRow[] {
  const rows: TokenTestRow[] = [{ text: "Token ready for the test", ok: true }];
  for (const step of steps) {
    if (step.state === "running" || step.state === "skipped") continue;
    const ok = step.state === "ok";
    const said = step.detail ? `: ${step.detail}` : "";
    switch (step.step) {
      case "resolve":
        if (!ok) rows.push({ text: `Could not find ${host ?? "the server"}${said}`, ok });
        break;
      case "connect":
      case "spawn":
        rows.push({ text: ok ? `Connected${host === null ? "" : ` to ${host}`}` : `Could not connect${said}`, ok });
        break;
      case "initialize":
        rows.push({ text: ok ? "Signed in" : `Could not sign in${said}`, ok });
        break;
      case "tools":
        rows.push({ text: ok ? `Listed ${step.detail ?? "the tools"}` : `Could not list the tools${said}`, ok });
        break;
      case "ping":
        if (!ok) rows.push({ text: `The server did not answer a ping${said}`, ok });
        break;
    }
  }
  return rows;
}

/**
 * What to tell a person when a token's test did not pass. `hadOne` is true when an older token is
 * stored: it is still in use. Otherwise nothing was saved.
 */
export function tokenTestFailure(result: McpTestResult, hadOne: boolean): string {
  const tail = hadOne ? "Your old token is still in use." : "Nothing was saved.";
  if (isRefused(result.http_status, null)) return `The server refused this token. ${tail}`;
  const failed = tokenTestRows(result.steps, null).find((row) => !row.ok);
  return `${failed?.text ?? "The test failed"}. ${tail}`;
}
