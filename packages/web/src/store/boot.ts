import { connectGolem, wsDial } from "@golem/client";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { exchangeToken, takeLoginToken } from "./login.ts";

/** The store for this page. It dials the gateway on the page's own host. */
export function createPageConnection(loc: Pick<Location, "protocol" | "host"> = location): ConnectionStore {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return createConnectionStore(() =>
    connectGolem({ dial: wsDial(`${scheme}://${loc.host}/ws`), clientName: "web", reconnect: true }),
  );
}

/**
 * Takes the login token from the address, trades it for the cookie, then connects. The result of
 * the trade is ignored: a stale token ends in close code 4401, which shows the unauthorized screen.
 */
export async function bootConnection(store: ConnectionStore): Promise<void> {
  const token = takeLoginToken();
  if (token !== null) {
    try {
      await exchangeToken(token);
    } catch {
      // The gateway is unreachable. The connection below shows that.
    }
  }
  store.start();
}
