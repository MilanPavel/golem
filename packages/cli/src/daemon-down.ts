/** Why the daemon could not start, as it wrote to `run/last-error`. */
export type StartError = { reason: string; next: string };

/** True for a connection error that means no daemon answered on the socket. */
export function isDaemonDown(message: string): boolean {
  return message.includes("ECONNREFUSED") || message.includes("ENOENT") || message.includes("timed out");
}

/**
 * What a command that needs the daemon prints when none answers.
 *
 * A start error the daemon wrote says more than the connection error, so it
 * wins. Otherwise the one command to run: `install` with no launch agent,
 * `start` with one, and `restart` for a daemon that took the connection but
 * never answered.
 */
export function explainDaemonDown(message: string, startError: StartError | null, installed: boolean): string {
  if (startError !== null) {
    return formatStartError(startError);
  }
  let command = "golem daemon install";
  if (installed) {
    command = message.includes("timed out") ? "golem daemon restart" : "golem daemon start";
  }
  return `daemon is not running (${message})\nrun: ${command}`;
}

export function formatStartError(error: StartError): string {
  const reason = `golem can't start: ${error.reason}`;
  return error.next.length > 0 ? `${reason}\nnext: ${error.next}` : reason;
}
