import { useCallback, useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { ago, shortDate, type DeviceInfo, type DeviceRule } from "../../store/devices.ts";
import { useDeviceList, usePageActions, usePairing } from "../../store/page-context.tsx";
import { settingsPath } from "../../store/router.ts";
import { useNavigate } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Input } from "../../ui/input.tsx";
import { Link } from "../../ui/link.tsx";
import { useNarrow } from "../trace/use-narrow.ts";
import { PairPanel } from "./devices/pair-panel.tsx";

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "pair" };

const active = (device: DeviceInfo): boolean => device.revoked_at == null;
const rulesLine = (count: number): string => `${count} ${count === 1 ? "rule" : "rules"} saved from it`;

function summary(device: DeviceInfo, now: number): string {
  if (!active(device)) return `revoked ${shortDate(device.revoked_at ?? "")}`;
  const seen = device.last_seen == null ? "never seen" : `last seen ${ago(device.last_seen, now)}`;
  const rules = (device.rules ?? 0) > 0 ? ` · ${rulesLine(device.rules ?? 0)}` : "";
  return `paired ${shortDate(device.paired_at)} · ${seen}${rules}`;
}

/**
 * The phones paired with this Mac: a list of them, then one phone's details, in the style of the MCP
 * servers. "+ Pair a phone" shows the QR code and, once the phone has shown the right code, the three
 * words to compare. Revoke asks once, cuts the phone off, and lists the rules it made, which stay.
 */
export function DevicesSection() {
  const list = useDeviceList();
  const pairing = usePairing();
  const narrow = useNarrow();
  const [view, setView] = useState<View>({ kind: "list" });
  const [now] = useState(() => Date.now());
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const back = useRef<string | null>(null);
  const register = useCallback((key: string, node: HTMLButtonElement | null) => {
    if (node === null) rows.current.delete(key);
    else rows.current.set(key, node);
  }, []);
  useEffect(() => {
    if (view.kind !== "list" || back.current === null) return;
    rows.current.get(back.current)?.focus();
    back.current = null;
  }, [view]);

  // A pairing in progress (this page's own) owns the detail pane until it is closed.
  const pairingOpen = pairing.snapshot.phase !== "idle";
  const startPairing = (): void => {
    setView({ kind: "pair" });
    void pairing.begin();
  };
  const closePairing = (): void => {
    pairing.dismiss();
    setView({ kind: "list" });
  };
  // Cancel while the code is up (or the words are shown) tells the daemon the pairing is off.
  const cancelPairing = (): void => {
    pairing.cancel();
    setView({ kind: "list" });
  };

  if (list.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(list.error, "Could not read the phones.")}
        </p>
        <Button size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.data === undefined) return <p className="text-body text-muted">asking the daemon…</p>;
  const devices = list.data.devices;
  const wide = !narrow;
  const showPair = pairingOpen && view.kind === "pair";
  const picked = view.kind === "detail" ? devices.find((d) => d.id === view.id) : undefined;
  const device = showPair ? undefined : (picked ?? (wide && view.kind !== "pair" ? devices[0] : undefined));

  const listPane = (
    <DeviceList
      devices={devices}
      now={now}
      wide={wide}
      selected={showPair ? null : (device?.id ?? null)}
      register={register}
      onPair={startPairing}
      onOpen={(d) => {
        if (pairingOpen) pairing.cancel();
        setView({ kind: "detail", id: d.id });
      }}
    />
  );
  const pane = showPair ? (
    <PairPanel
      snapshot={pairing.snapshot as Exclude<typeof pairing.snapshot, { phase: "idle" }>}
      onConfirm={(accept) => void pairing.confirm(accept)}
      onCancel={cancelPairing}
      onRetry={startPairing}
      onDone={closePairing}
    />
  ) : device === undefined ? null : (
    <Detail
      key={device.id}
      device={device}
      now={now}
      onBack={wide ? null : () => {
        back.current = device.id;
        setView({ kind: "list" });
      }}
    />
  );
  if (pane === null) {
    // Nothing to show beside the list: a narrow window, or no phone yet.
    return listPane;
  }
  if (!wide) return view.kind === "list" ? listPane : pane;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="w-mcp-list shrink-0 overflow-y-auto border-r border-line bg-bg p-3">{listPane}</div>
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">{pane}</div>
    </div>
  );
}

function DeviceList({
  devices,
  now,
  wide,
  selected,
  register,
  onPair,
  onOpen,
}: {
  devices: readonly DeviceInfo[];
  now: number;
  wide: boolean;
  selected: string | null;
  register: (key: string, node: HTMLButtonElement | null) => void;
  onPair: () => void;
  onOpen: (device: DeviceInfo) => void;
}) {
  const pairButton = (
    <Button kind="primary" size={wide ? "sm" : undefined} onClick={onPair}>
      + Pair a phone
    </Button>
  );
  if (devices.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">0 phones</p>
        <p className="text-sm text-muted">Pair a phone to answer approvals and watch runs from it. You can also run golem devices pair in a terminal.</p>
        <div>{pairButton}</div>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col", wide ? "gap-3" : "gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {devices.length} {devices.length === 1 ? "phone" : "phones"}
        </p>
        {pairButton}
      </div>
      <ul className={cn("flex flex-col", wide ? "gap-0.5" : "gap-2")}>
        {devices.map((device) => {
          const current = selected === device.id;
          return (
            <li key={device.id}>
              <button
                type="button"
                ref={(node) => register(device.id, node)}
                onClick={() => onOpen(device)}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
                  current ? "border-line-strong bg-surface" : wide ? "border-transparent hover:border-line" : "border-line bg-surface hover:border-line-strong",
                  !active(device) && "opacity-70",
                )}
              >
                <span className="flex min-w-0 items-center gap-x-2">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", active(device) ? "bg-allow" : "bg-faint")} />
                  <span className="min-w-0 truncate font-ui text-sm font-medium">{device.name}</span>
                  {active(device) ? null : <span className="shrink-0 text-meta text-faint">revoked</span>}
                </span>
                <span className="pl-4 text-meta text-muted wrap-anywhere">{summary(device, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Detail({ device, now, onBack }: { device: DeviceInfo; now: number; onBack: (() => void) | null }) {
  const actions = usePageActions();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<{ rules: readonly DeviceRule[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = active(device);

  async function rename(): Promise<void> {
    if (renaming === null || renaming.trim() === "") return;
    setBusy(true);
    try {
      await actions.renameDevice(device.id, renaming.trim());
      setRenaming(null);
      setError(null);
    } catch (failure) {
      setError(actionErrorText(failure, `Could not rename ${device.name}.`));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setAsking(false);
    setBusy(true);
    try {
      const done = await actions.revokeDevice(device.id);
      setRevoked({ rules: done.rules });
      setError(null);
    } catch (failure) {
      setError(actionErrorText(failure, `Could not revoke ${device.name}.`));
    } finally {
      setBusy(false);
    }
  }

  const rules = device.rules ?? 0;
  return (
    <div className="flex flex-col gap-3">
      {onBack === null ? null : (
        <div>
          <Button size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <h3 className="flex items-center gap-2 font-ui text-lg font-semibold wrap-anywhere">{device.name}</h3>
          <p className="text-meta text-muted">
            Paired {shortDate(device.paired_at)}
            {live ? (device.last_seen == null ? " · never seen" : ` · last seen ${ago(device.last_seen, now)}`) : ""}
          </p>
          <p className="text-meta text-muted">
            <Code tone="muted">{device.id.slice(0, 8)}</Code>
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-2 pt-1.5 text-meta text-muted">
          <span aria-hidden="true" className={cn("size-2 rounded-xs", live ? "bg-allow" : "bg-faint")} />
          {live ? "paired" : `revoked ${shortDate(device.revoked_at ?? "")}`}
        </p>
      </header>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          {renaming === null ? (
            <Button size="sm" onClick={() => setRenaming(device.name)}>
              Rename
            </Button>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input aria-label="Name" value={renaming} onChange={(event) => setRenaming(event.target.value)} maxLength={64} autoFocus className="w-56" autoComplete="off" />
              <Button kind="primary" size="sm" type="submit" disabled={busy || renaming.trim() === ""}>
                Save
              </Button>
              <Button size="sm" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </form>
          )}
          <Button kind="danger" size="sm" disabled={busy} onClick={() => setAsking(true)}>
            Revoke
          </Button>
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {revoked === null && rules > 0 ? (
        <p className="text-sm text-muted">
          {rulesLine(rules)}. They stay, marked "from a revoked device" once it is revoked, in{" "}
          <Link href={settingsPath("rules")} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
            Tool rules
          </Link>
          .
        </p>
      ) : null}
      {revoked === null ? null : (
        <section aria-label="After the revoke" className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
          <p role="status" className="text-sm">
            {device.name} is cut off. Its link is closed, and it must be paired again.
          </p>
          {revoked.rules.length === 0 ? (
            <p className="text-sm text-muted">It saved no "Always allow" rules.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                It saved {revoked.rules.length === 1 ? "this rule" : `these ${revoked.rules.length} rules`}. They stay, marked "from a revoked device", in{" "}
                <Link href={settingsPath("rules")} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
                  Tool rules
                </Link>
                :
              </p>
              <ul className="flex flex-col gap-1">
                {revoked.rules.map((rule) => (
                  <li key={`${rule.rule}@${rule.at}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <Code className="wrap-anywhere">{rule.rule}</Code>
                    <span className="text-meta text-faint">from a revoked device · {shortDate(rule.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {live ? <p className="text-meta text-faint">Revoking cuts the phone off at once. Rules it saved stay, marked "from a revoked device", so you can review them in Tool rules.</p> : null}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogTitle>Revoke {device.name}?</DialogTitle>
          <DialogDescription>
            It is cut off at once and must be paired again.
            {rules > 0 ? ` Its ${rules} "Always allow" ${rules === 1 ? "rule stays" : "rules stay"}.` : ""}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button autoFocus onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button kind="danger" onClick={() => void revoke()}>
              Revoke
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
