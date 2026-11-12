import { readRunFile, readTokenFile, resolveRunDir } from "@golem/gateway/node";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const DEFAULT_GATEWAY_PORT = 7480;

/** The running gateway's port: `run/web.json`, else `GOLEM_WEB_PORT`, else 7480. Read once. */
async function gatewayPort(): Promise<number> {
  try {
    const record = await readRunFile(resolveRunDir());
    if (record !== null) return record.port;
  } catch {
    // An unusable run directory means no gateway to find.
  }
  const given = Number(process.env["GOLEM_WEB_PORT"]);
  return Number.isInteger(given) && given > 0 && given < 65536 ? given : DEFAULT_GATEWAY_PORT;
}

/**
 * Only the dev page itself may use the proxy. The proxy rewrites Origin, so without this a page on
 * another site could reach the gateway through it looking same-origin.
 */
function fromDevPage(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const origin = req.headers["origin"];
  const host = req.headers["host"];
  return typeof origin === "string" && typeof host === "string" && origin === `http://${host}`;
}

/**
 * Sends `/ws`, `/auth`, and `/healthz` to the gateway. The gateway checks Host and Origin, and checks stay as
 * they are: the proxy sends the headers the gateway expects instead of loosening it. Cookie and
 * Sec-Fetch-Site pass as the browser sent them.
 */
function gatewayProxy(port: number): Record<string, ProxyOptions> {
  const host = `127.0.0.1:${port}`;
  const make = (ws: boolean): ProxyOptions => ({
    target: `http://${host}`,
    ws,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq, req) => {
        if (!fromDevPage(req)) {
          proxyReq.destroy();
          return;
        }
        proxyReq.setHeader("Host", host);
        proxyReq.setHeader("Origin", `http://${host}`);
      });
      proxy.on("proxyReqWs", (proxyReq, req, socket) => {
        if (!fromDevPage(req)) {
          proxyReq.destroy();
          socket.destroy();
          return;
        }
        proxyReq.setHeader("Host", host);
        proxyReq.setHeader("Origin", `http://${host}`);
      });
    },
  });
  return { "/ws": make(true), "/auth": make(false), "/healthz": make(false) };
}

/** Dev server only: prints the login link of the running gateway, or says to start one. */
function loginLink(): Plugin {
  return {
    name: "golem-login-link",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        void (async () => {
          const url = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
          try {
            const token = await readTokenFile(resolveRunDir());
            server.config.logger.info(`golem web dev: ${url}/#t=${token}`);
          } catch {
            server.config.logger.info("golem web dev: start golem web first, then restart this dev server");
          }
        })();
      });
    },
  };
}

export default defineConfig(async ({ command, mode }) => ({
  plugins: [react(), tailwindcss(), loginLink()],
  server: command === "serve" ? { proxy: gatewayProxy(await gatewayPort()) } : {},
  // `vite build --mode gallery` builds the static gallery (gallery.html) into dist-gallery, with
  // relative paths so it works under any prefix. The default build is the app and has no gallery.
  base: mode === "gallery" ? "./" : "/",
  build:
    mode === "gallery"
      ? { outDir: "dist-gallery", assetsDir: "assets", sourcemap: false, rollupOptions: { input: "gallery.html" } }
      : { outDir: "dist", assetsDir: "assets", sourcemap: false },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // axe walks the whole jsdom tree, and the gallery renders every component in both themes.
    // On a shared CI runner that took 5.4 s, just over the 5 s default.
    testTimeout: 20_000,
  },
}));
