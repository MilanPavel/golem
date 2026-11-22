import { Code } from "../../../ui/code.tsx";
import { CopyCommand } from "../../../ui/copy-command.tsx";
import { LockIcon } from "../../../ui/icons.tsx";
import { Sheet } from "./sheet.tsx";
import type { KeyWhere, ProviderEntry } from "./derive.ts";

/** The steps for a hosted provider with no key. The page never sees the key: it is typed in a terminal (ADR-028). */
export function ProviderSetup({ provider, envVar }: { provider: ProviderEntry; envVar: string }) {
  return (
    <section aria-label={`Set up ${provider.name}`} className="flex max-w-prose flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <h4 className="font-semibold">{`Set up ${provider.name}`}</h4>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-muted marker:text-faint">
        <li>
          Get an API key from {provider.name}.{" "}
          {provider.console === null ? null : (
            <a
              href={`https://${provider.console}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-clay-ink underline decoration-clay-ink/40 underline-offset-4 outline-offset-2 outline-clay focus-visible:outline-2"
            >
              {`Where (${provider.console.split("/")[0] ?? provider.console})`}
            </a>
          )}
        </li>
        <li className="flex flex-col items-start gap-1.5">
          <span>In a terminal, run this and paste the key when asked:</span>
          <CopyCommand command={`golem auth set ${provider.id}`} />
          <span className="flex items-start gap-1.5 text-meta text-faint">
            <LockIcon className="mt-0.5 size-3 shrink-0" />
            golem checks the key, then keeps it in the macOS Keychain. This page never sees it.
          </span>
        </li>
        <li>Come back here. The page notices the key by itself.</li>
      </ol>
      <p className="text-muted">
        Or set <Code>{envVar}</Code> in golem&apos;s environment; it wins over the Keychain.
      </p>
    </section>
  );
}

/** Replace or remove a key: the two commands, each with a copy button. A key from the environment is unset there. */
export function KeySheet({ provider, where, open, onOpenChange }: { provider: ProviderEntry; where: KeyWhere; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${provider.name} key`} description="Set and removed in a terminal. This page never sees the key.">
      <dl className="flex gap-x-3 text-sm">
        <dt className="w-16 shrink-0 text-faint">Where</dt>
        <dd>
          {where.source === "env" ? (
            <>
              <Code>{where.envVar}</Code> in golem&apos;s environment
            </>
          ) : (
            "macOS Keychain"
          )}
        </dd>
      </dl>
      <div className="flex flex-col items-start gap-1.5">
        <h3 className="text-sm font-semibold">Replace it</h3>
        <CopyCommand command={`golem auth set ${provider.id}`} />
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <h3 className="text-sm font-semibold">Remove it</h3>
        <CopyCommand command={`golem auth remove ${provider.id}`} />
        {where.source === "env" ? (
          <p className="text-sm text-muted">
            This key comes from the environment. To remove it, unset <Code>{where.envVar}</Code> there.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
