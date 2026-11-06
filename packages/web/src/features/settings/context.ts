import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import { useNewSessionFolder } from "../../store/page-context.tsx";

/**
 * The session the person came from, for the settings that depend on a folder or a session.
 * `cwd` is null until the session has a folder (it has none before it runs a tool).
 */
export type SettingsContext = { sessionId: string; cwd: string | null };

/** In memory only. The settings route carries neither the session nor the folder. */
export const settingsContextStore = createStore<SettingsContext | null>(null);

export function useSettingsContext(): SettingsContext | null {
  return useSyncExternalStore(settingsContextStore.subscribe, settingsContextStore.getSnapshot);
}

/**
 * A session screen calls this, so Settings opened from it knows the session. It does not clear the
 * context when the screen unmounts: that is when Settings opens. `cwd` is undefined while unknown.
 */
export function useRememberSettingsContext(sessionId: string, cwd: string | null | undefined): void {
  useEffect(() => {
    if (cwd === undefined) return;
    const now = settingsContextStore.getSnapshot();
    if (now?.sessionId === sessionId && now.cwd === cwd) return;
    settingsContextStore.set({ sessionId, cwd });
  }, [sessionId, cwd]);
}

/** The folder settings apply to: the remembered session's, else the next new session's, else none. */
export function useSettingsFolder(): string | null {
  const context = useSettingsContext();
  const [fresh] = useNewSessionFolder();
  return context?.cwd ?? fresh ?? null;
}
