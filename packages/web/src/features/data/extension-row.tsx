import { useState } from "react";
import { EXTENSION_BUTTON, extensionDownloading, extensionNote, type DataExtensionName } from "@golem/view";
import { dataErrorText } from "../../store/data.ts";
import { Button } from "../../ui/button.tsx";

/**
 * The offer to fetch the Excel or SQLite add-on. Nothing downloads until the person presses the button;
 * a download that fails says why and can be tried again.
 */
export function ExtensionRow({ name, onInstall, onDone }: { name: DataExtensionName; onInstall: (name: DataExtensionName) => Promise<void>; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function install(): void {
    setBusy(true);
    setError(null);
    onInstall(name).then(
      () => {
        setBusy(false);
        onDone?.();
      },
      (failed: unknown) => {
        setBusy(false);
        setError(dataErrorText(failed, "The download did not finish."));
      },
    );
  }
  return (
    <div data-extension={name} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
      <p className="text-sm text-muted">{extensionNote(name)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" kind="primary" aria-disabled={busy} onClick={busy ? undefined : install}>
          {EXTENSION_BUTTON}
        </Button>
        {busy ? (
          <span role="status" className="text-meta text-muted">
            {extensionDownloading(name)}
          </span>
        ) : null}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny wrap-anywhere">
          {error} You can try again.
        </p>
      )}
    </div>
  );
}
