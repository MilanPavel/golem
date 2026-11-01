import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleHtmlAssets, siteHref } from "./links.ts";

const blob = "https://github.com/MilanPavel/golem/blob/main/";

test("a link to another page stays as it is", () => {
  assert.equal(siteHref("adr/012-permission-rules.md", "architecture.md"), "adr/012-permission-rules.md");
  assert.equal(siteHref("../vision.md#1-web-ui", "adr/029-web-stack.md"), "../vision.md#1-web-ui");
});

test("anchors, absolute URLs, site paths, and images stay as they are", () => {
  for (const href of ["#the-idea", "https://agentskills.io", "mailto:a@b.c", "/golem/", "images/map.jpg", "../images/logo.svg"]) {
    assert.equal(siteHref(href, "adr/031-system-prompt.md"), href);
  }
});

test("a link out of docs/ goes to the file on GitHub, with its anchor", () => {
  assert.equal(siteHref("../README.md#use-skills", "architecture.md"), `${blob}README.md#use-skills`);
  assert.equal(siteHref("../../CONTRIBUTING.md", "adr/024-commits-prs-releases.md"), `${blob}CONTRIBUTING.md`);
  assert.equal(siteHref("../../scripts/version.sh", "adr/024-commits-prs-releases.md"), `${blob}scripts/version.sh`);
  assert.equal(siteHref("../packages/tui/src/theme.ts", "plan.md"), `${blob}packages/tui/src/theme.ts`);
});

test("a file in docs/ that is not a page goes to GitHub", () => {
  assert.equal(siteHref("prototype.html", "design/web.md"), `${blob}docs/design/prototype.html`);
  assert.equal(siteHref("template.md", "adr/README.md"), `${blob}docs/adr/template.md`);
  assert.equal(siteHref("concepts/_template.md", "README.md"), `${blob}docs/concepts/_template.md`);
});

test("a folder goes to the folder on GitHub", () => {
  assert.equal(siteHref("../packages/web/", "plan.md"), "https://github.com/MilanPavel/golem/tree/main/packages/web");
});

test("bare asset paths in raw HTML get ./ so Vite bundles them", () => {
  assert.equal(bundleHtmlAssets('<img src="images/map.jpg" alt="">'), '<img src="./images/map.jpg" alt="">');
  assert.equal(bundleHtmlAssets('<source srcset="images/a.svg">'), '<source srcset="./images/a.svg">');
  for (const html of ['<img src="./a.png">', '<img src="../a.png">', '<img src="https://x/a.png">', '<img src="/a.png">', '<img src="data:image/png;base64,">']) {
    assert.equal(bundleHtmlAssets(html), html);
  }
});
