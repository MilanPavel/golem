import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { randomSecret } from "../core.ts";
import { folderAssets } from "./load-assets.ts";
import { startGateway } from "./server.ts";
import type { Gateway } from "./server.ts";

let dir: string;
let gateway: Gateway;
let base: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-as-"));
  const site = path.join(dir, "site");
  fs.mkdirSync(path.join(site, "assets"), { recursive: true });
  fs.writeFileSync(path.join(site, "index.html"), "<h1>page</h1>");
  fs.writeFileSync(path.join(site, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(site, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  fs.writeFileSync(path.join(site, ".hidden"), "no");
  fs.symlinkSync(path.join(dir, "secret.txt"), path.join(site, "link.txt"));
  fs.writeFileSync(path.join(dir, "secret.txt"), "outside-secret");
  gateway = startGateway({
    port: 0,
    socketPath: path.join(dir, "d.sock"),
    token: randomSecret(),
    assets: folderAssets(site),
  });
  base = `http://127.0.0.1:${gateway.port}`;
});

afterEach(async () => {
  await gateway.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("folderAssets lists regular files only", () => {
  expect([...folderAssets(path.join(dir, "site")).keys()]).toEqual(["/assets/app-abc123.js", "/favicon.svg", "/index.html"]);
});

test("/ is the page, checked on every load, with the CSP", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("cache-control")).toBe("no-cache");
  expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  expect(await res.text()).toBe("<h1>page</h1>");
});

test("a hashed asset is immutable", async () => {
  const res = await fetch(`${base}/assets/app-abc123.js`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(res.headers.get("content-type")).toMatch(/javascript/);
});

test("a file outside /assets/ is no-cache", async () => {
  const res = await fetch(`${base}/favicon.svg`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-cache");
});

test("a page route serves the page, a missing file is 404", async () => {
  const route = await fetch(`${base}/s/abc`);
  expect(route.status).toBe(200);
  expect(await route.text()).toBe("<h1>page</h1>");
  expect((await fetch(`${base}/nope.js`)).status).toBe(404);
});

test("HEAD has the headers and no body", async () => {
  const res = await fetch(`${base}/`, { method: "HEAD" });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toBe("");
});

test("POST is 405 and a wrong Host is 403", async () => {
  expect((await fetch(`${base}/`, { method: "POST", body: "x" })).status).toBe(405);
  const res = await fetch(`${base}/`, { headers: { Host: "evil.example" } });
  expect(res.status).toBe(403);
});

test("dotfiles and symlinks are not served", async () => {
  expect((await fetch(`${base}/.hidden`)).status).toBe(404);
  const link = await fetch(`${base}/link.txt`);
  expect(link.status).toBe(404);
});

test("parent paths never reach a file outside the map", async () => {
  for (const target of ["/../etc/passwd", "/%2e%2e/etc/passwd", "/assets/..%2findex.html", "/assets/%2e%2e/secret.txt"]) {
    // fetch would normalise the dots away, so send the raw target over a socket.
    const body = await raw(target);
    expect(body).not.toContain("root:");
    expect(body).not.toContain("outside-secret");
  }
  expect(await raw("/assets/..%2findex.html")).toContain(" 404 ");
});

async function raw(target: string): Promise<string> {
  const chunks: string[] = [];
  await new Promise<void>((resolve) => {
    void Bun.connect({
      hostname: "127.0.0.1",
      port: gateway.port,
      socket: {
        open(s) {
          s.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${gateway.port}\r\nConnection: close\r\n\r\n`);
        },
        data(_s, d) {
          chunks.push(d.toString());
        },
        close() {
          resolve();
        },
        error() {
          resolve();
        },
      },
    });
  });
  return chunks.join("");
}
