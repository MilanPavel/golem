/** What `golem` does before the chat opens, when no daemon answers and no launch agent exists. */

export type ServiceChoice = "install" | "session" | "quit";

/** A daemon started for this window only. */
export type SessionDaemon = {
  stop: () => void;
  /** The end of what it wrote to stderr, for when it never answers. */
  output: () => string;
  /** True once the process ended, so waiting for it can stop. */
  exited: () => boolean;
};

export type Gate = {
  /** True when a daemon answers on the socket. */
  answers: () => Promise<boolean>;
  /** True when the launch agent's plist exists, loaded or not. */
  installed: () => boolean;
  /** stdin and stdout are a terminal, so a question can be asked. */
  interactive: boolean;
  ask: (question: string) => Promise<ServiceChoice>;
  /** `golem daemon install`. True when it worked; it printed its own error otherwise. */
  install: () => Promise<boolean>;
  /** `golem-daemon serve` as a child of this process, or null when it could not start. */
  serve: () => SessionDaemon | null;
  /** Waits until a daemon answers. False after the timeout, or as soon as `giveUp` says so. */
  waitUntilAnswers: (giveUp: () => boolean) => Promise<boolean>;
  write: (text: string) => void;
};

export type GateResult = { kind: "open"; session: SessionDaemon | null } | { kind: "exit"; code: number };

export const QUESTION =
  "\n" +
  "golem runs a small background service, so a chat keeps\n" +
  "going when you close the terminal.\n" +
  "\n" +
  "Start it now and at every login?\n" +
  "  Enter  yes\n" +
  "  n      only while this window is open\n" +
  "  q      quit\n";

export const LATER = "golem's service is not running. Run golem daemon install when you want it.\n";
export const STARTED = "✓ background service started, now and at every login\n";
export const SESSION_STARTED = "✓ golem's service runs until you close this window\n";
export const NO_ANSWER =
  "golem's service did not answer. See golem daemon logs, or logs/launchd.stderr.log in ~/.golem.\n";
export const SESSION_NO_ANSWER = "golem's service did not answer. See golem daemon logs.\n";

/** What a window daemon that never answered said, then where to look. */
export function sessionFailure(output: string): string {
  const tail = output.trim().split("\n").slice(-10).join("\n");
  return tail.length > 0 ? `${tail}\n${SESSION_NO_ANSWER}` : SESSION_NO_ANSWER;
}

/**
 * Asks once whether golem may start its service, and starts it.
 *
 * Nothing is asked when a daemon answers, when the launch agent already
 * exists (launchd owns it, and a daemon that does not answer is a different
 * problem), or when there is no terminal to ask in.
 */
export async function gateService(gate: Gate): Promise<GateResult> {
  if (await gate.answers()) {
    return { kind: "open", session: null };
  }
  if (gate.installed() || !gate.interactive) {
    return { kind: "open", session: null };
  }
  const choice = await gate.ask(QUESTION);
  if (choice === "quit") {
    gate.write(LATER);
    return { kind: "exit", code: 0 };
  }
  if (choice === "install") {
    if (!(await gate.install())) {
      return { kind: "exit", code: 1 };
    }
    if (!(await gate.waitUntilAnswers(() => false))) {
      gate.write(NO_ANSWER);
      return { kind: "exit", code: 1 };
    }
    gate.write(STARTED);
    return { kind: "open", session: null };
  }
  const session = gate.serve();
  if (session === null) {
    return { kind: "exit", code: 1 };
  }
  if (!(await gate.waitUntilAnswers(session.exited))) {
    session.stop();
    gate.write(sessionFailure(session.output()));
    return { kind: "exit", code: 1 };
  }
  gate.write(SESSION_STARTED);
  return { kind: "open", session };
}

/** The choice a key press makes, or null for a key that means nothing here. */
export function choiceForKey(key: string): ServiceChoice | null {
  if (key === "\r" || key === "\n" || key === "y" || key === "Y") {
    return "install";
  }
  if (key === "n" || key === "N") {
    return "session";
  }
  if (key === "q" || key === "Q" || key === "\u001b" || key === "\u0003" || key === "\u0004") {
    return "quit";
  }
  return null;
}
