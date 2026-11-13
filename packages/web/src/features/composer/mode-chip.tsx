import { effectiveMode, MODE_ALWAYS_ASKS, MODE_HINT, MODE_LABEL, PERMISSION_MODES, type PermissionMode } from "@golem/view";
import { useConfig, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";

const DOT: Record<PermissionMode, string> = { careful: "bg-muted", balanced: "bg-clay", autopilot: "bg-wait" };

export type ModeChoice = PermissionMode | "default";

/**
 * The permission mode of a chat: a chip with a dot (muted, clay, amber), and a menu with the three
 * modes and "Use the default". `own` is the mode this chat set, null when it follows the default.
 */
export function ModeChipView({
  own,
  fallback,
  onSelect,
  disabled = false,
}: {
  own: PermissionMode | null;
  fallback: PermissionMode;
  onSelect: (mode: PermissionMode | null) => void;
  disabled?: boolean;
}) {
  const mode = own ?? fallback;
  const label = `Permission mode: ${mode}${own === null ? ", the default" : ""}. Change it.`;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        title={`${MODE_LABEL[mode]}. ${MODE_HINT[mode]}`}
        aria-label={label}
        className={cn(
          badgeVariants(),
          "cursor-pointer outline-offset-2 outline-clay hover:border-ink hover:text-ink focus-visible:outline-2 disabled:cursor-default disabled:opacity-60",
        )}
      >
        <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[mode])} />
        {mode}
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

/** The chip for a session. The change is the dock's, so its failure shows on the dock's error line. */
export function ModeChip({ sessionId, onSelect }: { sessionId: string; onSelect: (mode: PermissionMode | null) => void }) {
  const { own, fallback } = useSessionMode(sessionId);
  return <ModeChipView own={own} fallback={fallback} onSelect={onSelect} />;
}
