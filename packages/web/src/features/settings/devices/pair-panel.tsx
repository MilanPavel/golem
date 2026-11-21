import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import type { PairingSnapshot } from "../../../store/devices.ts";
import { QrCode } from "./qr-code.tsx";

/** The time of day of a unix second, as the person's clock shows it. */
function clock(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Shown in place of a phone's details while a pairing is open, from the QR code to the result. */
export function PairPanel({
  snapshot,
  onConfirm,
  onCancel,
  onRetry,
  onDone,
}: {
  snapshot: Exclude<PairingSnapshot, { phase: "idle" }>;
  onConfirm: (accept: boolean) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDone: () => void;
}) {
  switch (snapshot.phase) {
    case "starting":
      return (
        <div className="flex flex-col gap-2">
          <h3 className="font-ui text-lg font-semibold">Pair a phone</h3>
          <p role="status" className="text-body text-muted">
            opening a pairing…
          </p>
        </div>
      );
    case "waiting":
      return (
        <div className="flex flex-col gap-4">
          <h3 className="font-ui text-lg font-semibold">Pair a phone</h3>
          <div className="flex flex-wrap gap-4">
            <QrCode text={snapshot.uri} label="Pairing code. Scan it with the golem app on your phone." />
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2 text-sm">
              <p>Open golem on the phone and scan this code.</p>
              <p className="text-muted">It works once, until {clock(snapshot.expiresAt)}. Then three words appear here and on the phone.</p>
              <p role="status" aria-live="polite" className="text-meta text-muted">
                waiting for the phone…
              </p>
              <div>
                <Button size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    case "words":
      return (
        <div className="flex flex-col gap-4">
          <h3 className="font-ui text-lg font-semibold">Pair a phone</h3>
          <p className="text-sm wrap-anywhere">
            <span className="font-medium">{snapshot.device?.name ?? "A phone"}</span>
            {snapshot.device?.model ? <span className="text-muted"> ({snapshot.device.model})</span> : null} wants to pair.
          </p>
          <p aria-label="The words to compare" className="text-title">
            <Code>{snapshot.words.join(" · ")}</Code>
          </p>
          <p className="text-sm text-muted">Confirm only if your phone shows the same words. They stay on screen for 2 minutes.</p>
          {snapshot.error === null ? null : (
            <p role="alert" className="text-sm text-deny">
              {snapshot.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" disabled={snapshot.busy} onClick={() => onConfirm(true)}>
              Pair it
            </Button>
            <Button disabled={snapshot.busy} onClick={() => onConfirm(false)}>
              Not these words
            </Button>
          </div>
        </div>
      );
    case "paired":
      return (
        <div className="flex flex-col gap-3">
          <h3 className="font-ui text-lg font-semibold">Paired</h3>
          <p role="status" className="text-sm">
            {snapshot.device?.name ?? "The phone"} is paired. It shows in the list, and Revoke cuts it off.
          </p>
          <div>
            <Button size="sm" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      );
    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <h3 className="font-ui text-lg font-semibold">Pair a phone</h3>
          <p role="status" className="text-sm text-muted">
            {snapshot.reason === "expired" ? "The code ended before the phone was paired." : "The pairing was refused or cancelled."} A new pairing needs a new code.
          </p>
          <div className="flex gap-2">
            <Button kind="primary" size="sm" onClick={onRetry}>
              Show a new code
            </Button>
            <Button size="sm" onClick={onDone}>
              Close
            </Button>
          </div>
        </div>
      );
    case "failed":
      return (
        <div className="flex flex-col gap-3">
          <h3 className="font-ui text-lg font-semibold">Pair a phone</h3>
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {snapshot.message}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
            <Button size="sm" onClick={onDone}>
              Close
            </Button>
          </div>
        </div>
      );
  }
}
