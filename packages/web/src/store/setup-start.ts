/**
 * Whether the page has already decided what setup does at its start. The decision is made once
 * per page load: the shell mounts again after a reconnect, and that must not open setup again.
 */
export type SetupStart = { decided(): boolean; decide(): void };

export function createSetupStart(): SetupStart {
  let done = false;
  return {
    decided: () => done,
    decide() {
      done = true;
    },
  };
}
