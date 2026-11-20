import type { InstallOffer } from "../../store/app-install.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

export type AppCardProps = {
  /** The way this browser installs the page, `installed`, or `null`: the card is not drawn. */
  offer: InstallOffer;
  /** The address the page is served from, for the bookmark line. */
  host: string;
  /** `ready` is the framed card on `/welcome`; `settings` is the `App` block of Settings → Appearance. */
  where: "ready" | "settings";
  onInstall: () => void;
};

const BODY = "Install this page as an app. It opens in its own window from the Dock, and stays signed in.";

/** Install the page as an app: a button where the browser has a prompt, a menu hint in Safari and Chrome, only the bookmark elsewhere. */
export function AppCard({ offer, host, where, onInstall }: AppCardProps) {
  if (offer === null) return null;
  const settings = where === "settings";
  const title = settings ? "App" : "Keep golem one click away";
  const bookmark = <Code tone="muted">{host}</Code>;
  return (
    <section
      aria-label={title}
      data-setting={settings ? "app" : undefined}
      className={cn("flex w-full flex-col gap-2 text-left", !settings && "rounded-md border border-line bg-surface px-3.5 py-3")}
    >
      {settings ? <h3 className="text-heading font-semibold">{title}</h3> : <span className="font-semibold">{title}</span>}
      {offer === "installed" ? (
        <p className="text-sm text-muted">golem is installed as an app. Open it from the Dock, or with Open in app in Chrome's address bar.</p>
      ) : (
        <>
          <p className="text-sm text-muted">{BODY}</p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-muted">
            {offer === "prompt" ? (
              <Button size="sm" onClick={onInstall}>
                Install golem as an app
              </Button>
            ) : offer === "safari" ? (
              <span>
                In Safari, choose <Code>File → Add to Dock…</Code>
              </span>
            ) : offer === "chromium" ? (
              <span>
                In Chrome, choose <Code>⋮ → Cast, save and share → Install page as app</Code>
              </span>
            ) : null}
            <span>
              {offer === "other" ? "Bookmark" : "or bookmark"} {bookmark}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
