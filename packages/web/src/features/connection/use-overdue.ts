import { useEffect, useState } from "react";

/**
 * True once `active` has stayed true for `ms`, and false again the moment it ends. Used to stop
 * promising that a gateway is restarting when it has been gone too long.
 */
export function useOverdue(active: boolean, ms: number): boolean {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => {
      setOverdue(true);
    }, ms);
    return () => {
      clearTimeout(timer);
      setOverdue(false);
    };
  }, [active, ms]);
  return active && overdue;
}
