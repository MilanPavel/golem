import type { ConfigAllowance, ConfigGetResult, ConfigRule } from "@golem/client";

export type { ConfigAllowance, ConfigGetResult, ConfigRule };

/** The query key of `config.get` for a folder and a session. The rule edits and `approval.resolved` mark `["config.get"]` stale. */
export const CONFIG_KEY = ["config.get"] as const;

export function configKey(cwd: string | null, sessionId: string | null): readonly unknown[] {
  return [...CONFIG_KEY, cwd, sessionId];
}
