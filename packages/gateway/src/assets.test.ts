import assert from "node:assert/strict";
import { test } from "node:test";

import { assetCacheControl, assetKey, fallbackKey } from "./core.ts";

test("assetKey maps the root to the page and leaves other paths alone", () => {
  assert.equal(assetKey("/"), "/index.html");
  assert.equal(assetKey("/assets/app-abc.js"), "/assets/app-abc.js");
  assert.equal(assetKey("/s/abc"), "/s/abc");
  assert.equal(assetKey("/../x"), "/../x");
});

test("fallbackKey serves the page for a path without an extension", () => {
  assert.equal(fallbackKey("/s/abc"), "/index.html");
  assert.equal(fallbackKey("/settings/x"), "/index.html");
  assert.equal(fallbackKey("/settings/"), "/index.html");
  assert.equal(fallbackKey("/nope.js"), null);
  assert.equal(fallbackKey("/assets/app.js"), null);
  assert.equal(fallbackKey("/a.b/c"), "/index.html");
});

test("assetCacheControl is immutable only under /assets/", () => {
  assert.equal(assetCacheControl("/assets/app-abc.js"), "public, max-age=31536000, immutable");
  assert.equal(assetCacheControl("/index.html"), "no-cache");
  assert.equal(assetCacheControl("/favicon.svg"), "no-cache");
  assert.equal(assetCacheControl("/other/assets/x.js"), "no-cache");
});
