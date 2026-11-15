import { keyWhere } from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import type { AuthKeyStatus } from "../../store/keys.ts";
import { useKeys } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { cn } from "../../ui/cn.ts";

/**
 * Where each provider's key is kept, from `auth.list`: in the environment, in the Keychain, or
 * missing. The page never sees a key and cannot set or remove one (ADR-028), so there is no input here.
 */
export function KeysSection() {
  // The query reads again when the section opens, when the link comes back, and when the tab is seen again.
  const keys = useKeys();
  if (keys.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(keys.error, "Could not read where the keys are.")}
        </p>
        <Button size="sm" onClick={() => void keys.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex max-w-column flex-col gap-3">
      <p className="text-sm text-muted">Keys are set and removed in a terminal. The page never sees one.</p>
      <div>
        <Button size="sm" disabled={keys.isFetching} onClick={() => void keys.refetch()}>
          Refresh
        </Button>
      </div>
      {keys.data === undefined ? <p className="font-mono text-sm text-muted">asking the daemon…</p> : <KeysList providers={keys.data.providers} />}
    </div>
  );
}

/** One row per provider that takes a key: its name, then where the key is, or the command that sets it. */
export function KeysList({ providers }: { providers: readonly AuthKeyStatus[] }) {
  return (
    <ul aria-label="API keys" className="divide-y divide-line rounded-lg border border-line">
      {providers
        .filter((status) => status.takes_key)
        .map((status) => {
          const missing = status.needs_key && status.source === null;
          return (
            <li key={status.provider} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", missing ? "bg-wait" : status.source === null ? "border border-faint" : "bg-allow")} />
              <span className="min-w-0 font-sans text-sm font-medium wrap-anywhere">{status.provider}</span>
              {missing ? (
                <>
                  <span className="font-mono text-xs text-wait">missing</span>
                  <span className="ml-auto">
                    <CopyCommand command={`golem auth set ${status.provider}`} />
                  </span>
                </>
              ) : (
                <span className="ml-auto font-mono text-xs text-muted">{keyWhere(status)}</span>
              )}
            </li>
          );
        })}
    </ul>
  );
}
