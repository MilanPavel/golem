import type { AgentRow, WishNow } from "@golem/view";
import { useState } from "react";
import { isAgentsMissing } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../ui/menu.tsx";

/** The line under a wish dropdown when the daemon refused it. A daemon that does not know `agents.set_wish` is said in words. */
function wishErrorText(error: unknown, name: string): string {
  if (isAgentsMissing(error)) return "This golem is too old to change a wish. Update golem.";
  return actionErrorText(error, `Could not change the wish of ${name}.`);
}

/** The square before a model: an outline for a model on this computer, filled for a hosted one. The model's name says the rest. */
export function TierDot({ tier }: { tier: WishNow["tier"] }) {
  if (tier === null) return null;
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", tier === "local" ? "border border-faint" : "bg-clay")} />;
}

/** `now <model>`, with a fresh window said in words, and why on the line below. */
function NowLines({ row }: { row: AgentRow }) {
  if (row.now === null) return null;
  return (
    <>
      <span className="flex items-center gap-1.5 text-meta text-muted">
        <TierDot tier={row.now.tier} />
        <span>
          now <Code tone="muted">{row.now.model}</Code>
          {row.now.freshWindow === "" ? null : `, ${row.now.freshWindow}`}
        </span>
      </span>
      {row.now.reason === "" ? null : <span className="text-meta text-muted">{row.now.reason}</span>}
    </>
  );
}

/**
 * The wish of an agent: a dropdown that saves each change, with what it means now. A broken agent, or a page with
 * nothing to save with, shows the wish as text. A refusal is a line below and the old value stays.
 */
export function ModelControl({ row, onSetWish }: { row: AgentRow; onSetWish: ((name: string, wish: string) => Promise<void>) | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!row.editable || onSetWish === undefined) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink">{row.wish}</span>
        <NowLines row={row} />
      </div>
    );
  }
  const choose = async (wish: string): Promise<void> => {
    if (wish === row.wishValue) return;
    setSaving(true);
    try {
      await onSetWish(row.name, wish);
      setError(null);
    } catch (failure) {
      setError(wishErrorText(failure, row.name));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Menu>
          <MenuTrigger
            disabled={saving}
            aria-label={`Model wish of ${row.name}: ${row.wish}. Change it.`}
            className="cursor-pointer rounded-md border border-line-strong bg-bg px-2.5 py-1 text-left text-sm text-ink outline-offset-2 outline-clay hover:border-ink focus-visible:outline-2 disabled:cursor-default disabled:opacity-60"
          >
            {row.wish}
          </MenuTrigger>
          <MenuContent className="w-72 max-sm:w-64">
            <MenuRadioGroup value={row.wishValue} onValueChange={(value) => void choose(value)}>
              {row.wishOptions.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  <span>{option.label}</span>
                  {option.hint === "" ? null : <span className="text-xs text-muted">{option.hint}</span>}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </div>
      <NowLines row={row} />
      {error === null ? null : (
        <span role="alert" className="text-xs text-deny">
          {error}
        </span>
      )}
    </div>
  );
}
