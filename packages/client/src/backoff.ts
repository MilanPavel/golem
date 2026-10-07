/** Full jitter. Attempt 1 tops out at 200 ms and later attempts double up to 5 s. */

const BASE_MS = 200;
const CAP_MS = 5_000;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}
