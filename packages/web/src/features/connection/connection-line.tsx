import type { ConnectionSnapshot } from "../../store/connection.ts";

/** The sidebar's connection line: a green mark, "connected", and the daemon's version once known. */
export function ConnectionLine({ snapshot }: { snapshot: ConnectionSnapshot }) {
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-muted">
      <span aria-hidden="true" className="size-2 rounded-xs bg-allow" />
      <span>connected</span>
      {snapshot.daemonVersion === null ? null : <span className="text-faint">golem v{snapshot.daemonVersion}</span>}
    </p>
  );
}
