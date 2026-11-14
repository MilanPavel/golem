import { loginDoneText, mcpSummary } from "@golem/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpLoginDone, McpServer } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";

/** Where one server's sign-in stands, from the click to the daemon's answer. `text` is `loginDoneText`'s. */
export type Login = { kind: "waiting"; url: string | null } | { kind: "done"; text: string } | { kind: "failed"; error: string };

export function serverKey(name: string, project: string | null | undefined): string {
  return `${project ?? ""}\u0000${name}`;
}

export function needsAuth(server: McpServer): boolean {
  return server.state === "needs_auth";
}

/** The square mark of a server's state; its word is always written beside it. */
function dotLook(server: McpServer): string {
  switch (server.state) {
    case "running":
      return "bg-allow";
    case "failed":
      return "bg-deny";
    case "starting":
    case "needs_auth":
      return "bg-wait";
    case "disabled":
      return "bg-line-strong";
    default:
      return "border border-faint";
  }
}

export function Dot({ server }: { server: McpServer }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", dotLook(server))} />;
}

/** What the sign-in says about itself, or null before one has begun. */
export function loginLine(login: Login | undefined): string | null {
  if (login === undefined) return null;
  switch (login.kind) {
    case "waiting":
      return "Waiting for the sign-in…";
    case "done":
      return login.text;
    case "failed":
      return login.error;
  }
}

/** One row's second line: the sign-in while it is under way, else the usual summary. */
export function serverSummary(server: McpServer, session: boolean, login: Login | undefined): string {
  const line = loginLine(login);
  if (line !== null && (needsAuth(server) || login?.kind === "done")) return line;
  return mcpSummary(server, session);
}

/** A sign-in's place in the detail: what it says, and the button that starts or repeats it. */
export function SignInPanel({ name, login, onSignIn }: { name: string; login: Login | undefined; onSignIn: () => void }) {
  const line = loginLine(login);
  const waiting = login?.kind === "waiting";
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-bg px-4 py-4">
      <p className="text-sm font-medium">{name} needs a sign-in.</p>
      <p className="text-sm text-muted">Sign in to see its tools. golem opens the sign-in page in a new tab and keeps the token in the Keychain.</p>
      {waiting ? (
        <p role="status" className="font-mono text-xs text-muted">
          {line}
          {login.url === null ? null : (
            <>
              {" "}
              <a href={login.url} target="_blank" rel="noopener noreferrer" className="text-clay underline">
                Open the sign-in page
              </a>
            </>
          )}
        </p>
      ) : (
        <>
          {login?.kind === "failed" ? (
            <p role="alert" className="text-sm text-deny wrap-anywhere">
              {line}
            </p>
          ) : null}
          {login?.kind === "done" ? (
            <p role="status" className="font-mono text-xs text-muted">
              {line}
            </p>
          ) : null}
          <Button kind="primary" size="sm" onClick={onSignIn}>
            {login?.kind === "failed" ? "Try again" : "Sign in"}
          </Button>
        </>
      )}
    </div>
  );
}

export type SignIns = {
  logins: ReadonlyMap<string, Login>;
  /** Asks the daemon for the address, opens it in a new tab, and waits for `mcp.login.done`. */
  start: (server: McpServer, sessionId: string | null) => void;
  /** Drops what is known of a server's sign-in, after it signed out. */
  forget: (server: McpServer) => void;
};

/** The sign-ins of every server the section shows, kept for as long as the section is open. */
export function useSignIns(): SignIns {
  const actions = usePageActions();
  const [logins, setLogins] = useState<ReadonlyMap<string, Login>>(new Map());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = useCallback((key: string, login: Login): void => {
    if (!mounted.current) return;
    setLogins((now) => new Map(now).set(key, login));
  }, []);
  useEffect(
    () =>
      actions.watchMcpLogin((done: McpLoginDone) => {
        const text = loginDoneText(done, null);
        set(serverKey(done.name, done.project), done.ok ? { kind: "done", text } : { kind: "failed", error: text });
      }),
    [actions, set],
  );
  const start = useCallback(
    (server: McpServer, sessionId: string | null): void => {
      const key = serverKey(server.name, server.project);
      set(key, { kind: "waiting", url: null });
      actions.loginMcp(server.name, sessionId).then(
        (url) => {
          // The answer may already be in, if the sign-in was quick.
          if (mounted.current) setLogins((now) => (now.get(key)?.kind === "waiting" ? new Map(now).set(key, { kind: "waiting", url }) : now));
          window.open(url, "_blank", "noopener,noreferrer");
        },
        (error: unknown) => {
          set(key, { kind: "failed", error: actionErrorText(error, `Could not start the sign-in to ${server.name}.`) });
        },
      );
    },
    [actions, set],
  );
  const forget = useCallback((server: McpServer): void => {
    if (!mounted.current) return;
    setLogins((now) => {
      const next = new Map(now);
      next.delete(serverKey(server.name, server.project));
      return next;
    });
  }, []);
  return { logins, start, forget };
}
