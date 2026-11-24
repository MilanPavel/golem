import { useEffect, useState } from "react";

/** A timer a test can move. The real one is the browser's. */
export type Timer = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export const REAL_TIMER: Timer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** The value, but only after it has stayed the same for `ms`. The first value is given at once. */
export function useDebounced<T>(value: T, ms: number, timer: Timer = REAL_TIMER): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const handle = timer.set(() => {
      setSettled(value);
    }, ms);
    return () => {
      timer.clear(handle);
    };
  }, [value, settled, ms, timer]);
  return settled;
}
