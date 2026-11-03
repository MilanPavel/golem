/** A daemon this terminal started, which stops when golem quits. */
export type WindowDaemon = {
  stop: () => void;
  /** True once the process ended, so the wait for it can stop. */
  exited: () => boolean;
  /** The end of what it wrote to stderr, for when it never answers. */
  output: () => string;
};

/** What the chat screen may ask about golem's background service. */
export type ServiceControl = {
  /** Why the daemon could not start, as it wrote to `run/last-error`. */
  startError: () => { reason: string; next: string } | null;
  /** True when the launch agent exists, so launchd should be running the daemon. */
  installed: () => boolean;
  /**
   * True when launchd has the job loaded and the program it names still
   * exists, so waiting for it makes sense. False after `brew uninstall`, a
   * `launchctl bootout`, or a plist left by another golem: then it needs
   * `golem daemon install` again.
   */
  agentLoaded: () => boolean;
  /** `golem daemon restart`. Rejects with why it failed. Null when this screen cannot restart it. */
  restart: (() => Promise<void>) | null;
  /** `golem daemon install`, quietly. Rejects with why. Null when this screen cannot. */
  install: (() => Promise<void>) | null;
  /** `golem daemon uninstall`, quietly. Rejects with why. Null when this screen cannot. */
  uninstall: (() => Promise<void>) | null;
  /** `golem-daemon serve` for as long as this terminal runs golem. Throws when it can't start. */
  serve: (() => WindowDaemon) | null;
  /** The daemon this terminal started, if it did. */
  windowDaemon: () => WindowDaemon | null;
  /** The last lines of the service's log, for Show the log. */
  logTail: () => string[];
};

export const RESTARTING = "restarting golem's service…";
