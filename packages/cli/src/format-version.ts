/** CLI version, and the daemon version on the next line when the daemon answered. */
export function formatCliVersion(cli: string, daemon: string | null): string {
  if (daemon === null || daemon.length === 0) {
    return `golem ${cli}`;
  }
  return `golem ${cli}\ndaemon ${daemon}`;
}
