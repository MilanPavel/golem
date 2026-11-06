import { isLoosening, itemText, permissionItems, ruleChange, DEFAULT_LOCKED, type PermissionItem, type RuleKey } from "@golem/view";
import { useMemo, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions, useConfig } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { useSettingsContext, useSettingsFolder } from "./context.ts";

const ACTIONS = ["allow", "ask", "deny"] as const;
const LABEL = { allow: "Allow", ask: "Ask", deny: "Deny" } as const;
const TONE = { allow: "text-allow", ask: "text-wait", deny: "text-deny" } as const;
const NOW = { allow: "allows", ask: "asks", deny: "denies" } as const;

type RuleItem = Extract<PermissionItem, { kind: "rule" }>;
type Pending = { item: RuleItem; key: RuleKey };

/** The scope of a rule in words, as the terminal lists it: the tool, then `match` and `path`. */
function scopeOf(item: RuleItem): string {
  const parts = [item.tool];
  if (item.match !== null) parts.push(`match "${item.match}"`);
  if (item.path !== null) parts.push(`path "${item.path}"`);
  return parts.join(" ");
}

function ruleName(item: RuleItem): string {
  return `${item.tool} rule ${item.index}`;
}

/** The tool rules in check order, then what the session allows, with the changes the terminal's /permissions makes. */
export function RulesSection() {
  const context = useSettingsContext();
  const folder = useSettingsFolder();
  const sessionId = context?.sessionId ?? null;
  const config = useConfig(folder, sessionId);
  const actions = usePageActions();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const items = useMemo(() => permissionItems(config.data ?? null), [config.data]);

  async function run(item: PermissionItem, key: RuleKey): Promise<void> {
    const change = ruleChange(item, key);
    const where = (target: "user" | "project") => (target === "project" ? (folder ?? undefined) : undefined);
    try {
      switch (change.kind) {
        case "notice":
          setError(null);
          setNotice(change.text);
          return;
        case "update":
          await actions.updateRule(change.target, change.index, change.action, where(change.target));
          setNotice(`rule ${change.index} now ${NOW[change.action]}`);
          break;
        case "remove":
          await actions.removeRule(change.target, change.index, where(change.target));
          setNotice(`rule ${change.index} removed`);
          break;
        case "revoke":
          if (sessionId === null) return;
          await actions.revokeAllowance(sessionId, change.tool, change.subject);
          setNotice(`${change.tool} is no longer allowed for this session`);
          break;
        default:
          return;
      }
      setError(null);
    } catch (failure) {
      setNotice(null);
      setError(actionErrorText(failure, "Could not change the rule."));
    }
  }

  function press(item: PermissionItem, key: RuleKey): void {
    if (item.kind === "rule" && isLoosening(item, key)) {
      setPending({ item, key });
      return;
    }
    void run(item, key);
  }

  const trusted = config.data?.project_trusted;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted wrap-anywhere">
          {folder === null ? "no folder" : folder}
          {sessionId === null ? "" : ` · session ${sessionId}`}
        </p>
        <Button size="sm" onClick={() => void config.refetch()}>
          Refresh
        </Button>
      </div>
      {folder === null ? <p className="text-sm text-muted">Open a session to see its folder's rules.</p> : null}
      {trusted === false ? (
        <p className="text-sm text-muted">This folder's allow rules do not count until the folder is trusted.</p>
      ) : null}
      <p role="status" aria-live="polite" className="min-h-5 font-mono text-xs text-muted">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {config.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {actionErrorText(config.error, "Could not read the rules.")}
          </p>
          <Button size="sm" onClick={() => void config.refetch()}>
            Retry
          </Button>
        </div>
      ) : config.data === undefined ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : (
        <ul aria-label="Tool rules" className="flex flex-col gap-2">
          {items.map((item, at) => (
            <Row key={`${at}-${itemText(item)}`} item={item} canRevoke={sessionId !== null} onPress={press} />
          ))}
        </ul>
      )}
      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
        <DialogContent>
          {pending === null ? null : (
            <Confirm
              pending={pending}
              onCancel={() => setPending(null)}
              onConfirm={() => {
                setPending(null);
                void run(pending.item, pending.key);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ item, canRevoke, onPress }: { item: PermissionItem; canRevoke: boolean; onPress: (item: PermissionItem, key: RuleKey) => void }) {
  if (item.kind === "allowance") {
    const what = item.subject === null ? item.tool : `${item.tool} ${item.subject}`;
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
        <p className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">
          <span className="text-faint">session </span>
          <span className="text-allow">allow</span> {what} <span className="text-muted">(for this session)</span>
        </p>
        {canRevoke ? (
          <Button size="sm" aria-label={`Revoke ${what}`} onClick={() => onPress(item, "delete")}>
            Revoke
          </Button>
        ) : null}
      </li>
    );
  }
  const locked = item.file === "default" || item.index === null;
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2", (locked || item.ignored !== null) && "opacity-70")}>
      <p className="font-mono text-sm wrap-anywhere">
        <span className={TONE[item.action]}>{item.action}</span> {scopeOf(item)}{" "}
        <span className="text-muted">{item.source}</span>
        {item.ignored === null ? null : <span className="text-muted">, ignored: {item.ignored}</span>}
      </p>
      {locked ? (
        <p className="text-xs text-muted">{DEFAULT_LOCKED}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={`Action for ${ruleName(item)}`} className="flex gap-1">
            {ACTIONS.map((action) => (
              <Button key={action} size="sm" aria-pressed={item.action === action} className="aria-pressed:bg-clay-soft aria-pressed:text-clay-ink" onClick={() => onPress(item, action)}>
                {LABEL[action]}
              </Button>
            ))}
          </div>
          <Button size="sm" kind="danger" aria-label={`Remove ${ruleName(item)}`} onClick={() => onPress(item, "delete")}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

function Confirm({ pending, onCancel, onConfirm }: { pending: Pending; onCancel: () => void; onConfirm: () => void }) {
  const { item, key } = pending;
  const allowing = key === "allow";
  return (
    <>
      <DialogTitle>{allowing ? `Allow ${item.tool} without asking?` : "Remove this rule?"}</DialogTitle>
      <DialogDescription>
        <span className="font-mono">
          {item.action} {scopeOf(item)}
        </span>{" "}
        from {item.source}. golem will not ask before it runs this on your Mac.
      </DialogDescription>
      <div className="mt-4 flex justify-end gap-2">
        <Button autoFocus onClick={onCancel}>
          Cancel
        </Button>
        <Button kind={allowing ? "primary" : "danger"} onClick={onConfirm}>
          {allowing ? "Allow" : "Remove"}
        </Button>
      </div>
    </>
  );
}
