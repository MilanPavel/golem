// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = new URL("../../", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

test("no service worker is registered anywhere in the page", () => {
  const sources = [...files(join(root, "src")).filter((f) => !f.endsWith("no-service-worker.test.ts")), join(root, "index.html")];
  const hits = sources.filter((file) => /serviceWorker/.test(readFileSync(file, "utf8")));
  expect(hits).toEqual([]);
});

test("public/ holds no service worker file", () => {
  const names = readdirSync(join(root, "public"));
  expect(names.filter((name) => /^sw.*\.js$/.test(name) || /^service-worker/.test(name))).toEqual([]);
});
