import { effectiveMode, MODE_ALWAYS_ASKS, MODE_HINT, MODE_LABEL, PERMISSION_MODES, PLAN_HINT, type PermissionMode } from "@golem/view";
import { useConfig, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { BAR_CHIP, ICON_UNDER_500 } from "./composer-bar.ts";
import { usePlanOn } from "./use-plan-on.ts";
import { PlanIcon, ShieldIcon } from "../../ui/icons.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";

export type ModeChoice = PermissionMode | "default";

/**
 * The permission mode of a chat, in the composer's row: a chip with a shield and the mode's name, and
 * a menu with the three modes, "Use the default" and, at the bottom, the Plan first switch. With plan
 * first on, the chip reads "Plan" in clay. `own` is the mode this chat set, null when it follows the default.
 * Under 500 px of composer the name turns into the icon alone.
 */
export function ModeChipView({
  own,
  fallback,
  plan = false,
  onSelect,
  onPlan,
  disabled = false,
}: {
  own: PermissionMode | null;
  fallback: PermissionMode;
  plan?: boolean;
  onSelect: (mode: PermissionMode | null) => void;
  onPlan?: (on: boolean) => void;
  disabled?: boolean;
}) {
  const mode = own ?? fallback;
  const label = `Permission mode: ${mode}${own === null ? ", the default" : ""}.${plan ? " Plan first is on." : ""} Change it.`;
  const Icon = plan ? PlanIcon : ShieldIcon;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        title={`${MODE_LABEL[mode]}. ${MODE_HINT[mode]}${plan ? ` Plan first is on. ${PLAN_HINT}` : ""}`}
        aria-label={label}
        className={cn(BAR_CHIP, plan && "bg-clay-soft text-clay-ink hover:bg-clay-soft hover:text-clay-ink")}
      >
        <Icon />
        <span className={ICON_UNDER_500}>{plan ? "Plan" : MODE_LABEL[mode]}</span>
      </MenuTrigger>
      <MenuContent align="end" className="w-72 max-sm:w-64">
        <MenuLabel>Permission mode</MenuLabel>
        <MenuRadioGroup
          value={own ?? "default"}
          onValueChange={(value) => onSelect(value === "default" ? null : (value as PermissionMode))}
        >
          {PERMISSION_MODES.map((item) => (
            <MenuRadioItem key={item} value={item}>
              <span>{MODE_LABEL[item]}</span>
              <span className="text-xs text-muted">{MODE_HINT[item]}</span>
            </MenuRadioItem>
          ))}
          <MenuSeparator />
          <MenuRadioItem value="default">
            <span>Use the default ({fallback})</span>
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted">{MODE_ALWAYS_ASKS}</p>
        {onPlan === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuCheckboxItem checked={plan} onCheckedChange={onPlan} className="items-start">
              <span className="flex min-w-0 flex-col">
                <span>Plan first</span>
                <span className="text-xs text-muted">{PLAN_HINT}</span>
              </span>
            </MenuCheckboxItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

const selectOwn = ({ chat }: SessionView) => chat.permissionMode;
const selectCwd = (view: SessionView) => view.cwd;

/** What the composer and the chip read for a session: its own mode, and the default behind it. */
export function useSessionMode(sessionId: string): { own: PermissionMode | null; fallback: PermissionMode; mode: PermissionMode } {
  const own = useSession(sessionId, selectOwn);
  const cwd = useSession(sessionId, selectCwd);
  const config = useConfig(cwd, sessionId);
  const fallback = effectiveMode(null, config.data?.default_permission_mode);
  return { own, fallback, mode: own ?? fallback };
}

/** The chip for a session. The changes are the dock's, so a failure shows on the dock's error line. */
export function ModeChip({
  sessionId,
  onSelect,
  onPlan,
}: {
  sessionId: string;
  onSelect: (mode: PermissionMode | null) => void;
  onPlan: (on: boolean) => void;
}) {
  const { own, fallback } = useSessionMode(sessionId);
  return <ModeChipView own={own} fallback={fallback} plan={usePlanOn(sessionId)} onSelect={onSelect} onPlan={onPlan} />;
}
