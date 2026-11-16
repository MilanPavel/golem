import type { AuthKeyStatus } from "@golem/client";

/** Where a provider's key is kept, in words. It says where the key is, never what it is. */
export function keyWhere(status: AuthKeyStatus): string {
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
