/** How long the "again to exit" hint stays armed. */
export const EXIT_WINDOW_MS = 2_000;

export const EXIT_HINT = "Ctrl-C again to exit";

export type InterruptState = {
  /** When the exit hint was shown, or `null`. */
  armedAt: number | null;
  /** The run a Ctrl-C already asked to cancel. */
  cancelling: string | null;
};

export const idleInterrupt: InterruptState = { armedAt: null, cancelling: null };

export type InterruptAction = { kind: "cancel"; runId: string } | { kind: "arm" } | { kind: "exit" };

/**
 * One Ctrl-C press.
 *
 * With a run in progress, the first press cancels it. Otherwise, or once the
 * cancel is on its way, a press arms the exit, and a second press within
 * {@link EXIT_WINDOW_MS} exits.
 */
export function pressCtrlC(
  state: InterruptState,
  runId: string | null,
  now: number,
): { state: InterruptState; action: InterruptAction } {
  if (runId !== null && state.cancelling !== runId) {
    return { state: { armedAt: null, cancelling: runId }, action: { kind: "cancel", runId } };
  }
  if (state.armedAt !== null && now - state.armedAt <= EXIT_WINDOW_MS) {
    return { state: { ...state, armedAt: null }, action: { kind: "exit" } };
  }
  return { state: { ...state, armedAt: now }, action: { kind: "arm" } };
}
