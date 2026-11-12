import { connectGolem, wsDial } from "@golem/client";
import type { AppInstallStore } from "./app-install.ts";
import { createPage, type Page } from "./page.ts";
import { exchangeToken, takeLoginToken } from "./login.ts";

/**
 * Takes the login token from the address, trades it for the cookie, then makes the one client
 * (it dials the gateway on the page's own host) and the page's stores on it. The result of the
 * trade is ignored: a stale token ends in close code 4401, which shows the unauthorized screen.
 * `appInstall` is made at load, before the trade, so the install prompt is not missed. The caller starts the page.
 */
export async function bootPage(loc: Pick<Location, "protocol" | "host"> = location, appInstall?: AppInstallStore): Promise<Page> {
  const token = takeLoginToken();
  if (token !== null) {
    try {
      await exchangeToken(token);
    } catch {
      // The gateway is unreachable. The connection shows that.
    }
  }
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  const client = connectGolem({ dial: wsDial(`${scheme}://${loc.host}/ws`), clientName: "web", reconnect: true });
  return createPage(client, appInstall === undefined ? {} : { appInstall });
}
