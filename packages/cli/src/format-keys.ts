import type { AuthKeyStatus } from "../../protocol/gen/auth-list-result.ts";

/** One row per provider that takes a key. It says where the key is, never what it is. */
export function formatKeys(providers: readonly AuthKeyStatus[]): string {
  const rows = providers.filter((status) => status.takes_key).map((status) => [status.provider, keyWhere(status)]);
  const width = rows.reduce((max, [name]) => Math.max(max, name?.length ?? 0), 0);
  return rows.map(([name, where]) => `${(name ?? "").padEnd(width)}  ${where}`).join("\n");
}

function keyWhere(status: AuthKeyStatus): string {
  if (status.source === "env") {
    return `from ${status.env_var ?? "the environment"}`;
  }
  if (status.source === "keychain") {
    return "in the Keychain";
  }
  if (status.needs_key) {
    return `missing: golem auth set ${status.provider}`;
  }
  return "none needed";
}
