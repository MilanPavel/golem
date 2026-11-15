import type { AuthKeyStatus, AuthListResult } from "@golem/client";

export type { AuthKeyStatus, AuthListResult };

/**
 * The query key of `auth.list`. No event announces a key change, so the page reads it again when
 * Settings opens, when the link comes back, and when the tab is seen again. It holds where each key
 * is kept, never a key.
 */
export const KEYS_KEY = ["auth.list"] as const;
