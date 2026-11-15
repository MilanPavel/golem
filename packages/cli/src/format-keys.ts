import type { AuthKeyStatus } from "@golem/client";
import { keyWhere } from "@golem/view";

/** One row per provider that takes a key. It says where the key is, never what it is. */
export function formatKeys(providers: readonly AuthKeyStatus[]): string {
  const rows = providers.filter((status) => status.takes_key).map((status) => [status.provider, keyWhere(status)]);
  const width = rows.reduce((max, [name]) => Math.max(max, name?.length ?? 0), 0);
  return rows.map(([name, where]) => `${(name ?? "").padEnd(width)}  ${where}`).join("\n");
}
