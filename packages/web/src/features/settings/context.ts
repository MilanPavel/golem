import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import { useNewSessionFolder, useSessionList } from "../../store/page-context.tsx";
import { sessionPath } from "../../store/router.ts";

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

/** Where Back from Settings goes: the remembered session, else home, with the words for it. */
export function useSettingsBack(): { path: string; where: string } {
  const context = useSettingsContext();
  const sessions = useSessionList();
  if (context === null) return { path: "/", where: "Chats" };
  const title = sessions.find((session) => session.session_id === context.sessionId)?.title;
  return { path: sessionPath(context.sessionId), where: title === null || title === undefined || title === "" ? "Untitled" : title };
}
