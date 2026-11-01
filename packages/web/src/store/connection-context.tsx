import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ConnectionSnapshot, ConnectionSource } from "./connection.ts";

const ConnectionContext = createContext<ConnectionSource | null>(null);

export function ConnectionProvider({ source, children }: { source: ConnectionSource; children: ReactNode }) {
  return <ConnectionContext.Provider value={source}>{children}</ConnectionContext.Provider>;
}

/** The link state and the daemon's version. Re-renders only when one changes. */
export function useConnection(): ConnectionSnapshot {
  const source = useContext(ConnectionContext);
  if (!source) {
    throw new Error("useConnection needs a ConnectionProvider above it.");
  }
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}
