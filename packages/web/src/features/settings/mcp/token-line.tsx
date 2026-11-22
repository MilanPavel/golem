import { isRefused, signInLine, type SignInLine } from "@golem/view";
import { useCallback, useEffect, useState } from "react";
import type { McpServer } from "../../../store/mcp.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { LockIcon } from "../../../ui/icons.tsx";
import { serverKey } from "./sign-in.tsx";

type Known = { workedAt: number | null; refused: boolean };

/** What a test or a connect told about one server's token, as the page has seen it. */
export type TokenStates = {
  /** When the server last connected or passed a test, and whether the last try was refused with 401 or 403. */
  of: (server: McpServer) => Known | undefined;
  /** A connect or a test ended. `refused` is true for a 401 or 403. */
  note: (server: McpServer, outcome: { ok: true } | { ok: false; refused: boolean }) => void;
};

/** The token's standing of every server the section shows, kept for as long as the section is open. */
export function useTokenStates(): TokenStates {
  const [known, setKnown] = useState<ReadonlyMap<string, Known>>(new Map());
  const note = useCallback<TokenStates["note"]>((server, outcome) => {
    const key = serverKey(server.name, server.project);
    setKnown((now) => {
      const before = now.get(key);
      const next: Known = outcome.ok ? { workedAt: Date.now(), refused: false } : { workedAt: before?.workedAt ?? null, refused: outcome.refused };
      return new Map(now).set(key, next);
    });
  }, []);
  const of = useCallback((server: McpServer) => known.get(serverKey(server.name, server.project)), [known]);
  return { of, note };
}

/** The clock for "worked 2 min ago", read again every half minute. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** The line for a server: from its list row, its secrets, and what the page has seen of its token. */
export function lineFor(server: McpServer, input: { oauth: boolean; secrets: readonly { ref: string; stored: boolean }[]; known: Known | undefined; now: number }): SignInLine | null {
  const refused = (input.known?.refused ?? false) || (server.state === "failed" && isRefused(null, server.error));
  return signInLine({ oauth: input.oauth, state: server.state, secrets: input.secrets, refused, workedAt: input.known?.workedAt ?? null, now: input.now });
}

/** One sentence under the server's name: whether its token or sign-in is there, and the one thing to do about it. */
export function TokenLine({ line, onAction, canEdit, waiting }: { line: SignInLine; onAction: (kind: SignInLine["action"]["kind"]) => void; canEdit: boolean; waiting: boolean }) {
  // Replace and Add it open Edit, which a project server cannot show without a chat. A sign-in under way is not started twice.
  const acts = line.action.kind === "sign-in" ? !waiting : canEdit || line.action.kind !== "replace" && line.action.kind !== "add";
  return (
    <p
      data-setting="mcp token"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5 text-sm",
        line.tone === "bad" ? "border-transparent bg-deny-soft" : "border-line bg-bg",
      )}
    >
      <LockIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
      <b className="font-semibold">{line.label}</b>
      {line.ref === null ? null : (
        <span className="text-muted">
          · in the Keychain as <Code>{line.ref}</Code>
        </span>
      )}
      {line.worked === null ? null : <span className="text-muted">· {line.worked}</span>}
      {acts ? (
        <>
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <Button size="sm" onClick={() => onAction(line.action.kind)}>
            {line.action.label}
          </Button>
        </>
      ) : null}
    </p>
  );
}
