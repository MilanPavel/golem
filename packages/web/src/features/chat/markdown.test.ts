import { expect, test } from "vitest";
import { renderMarkdown } from "./markdown.ts";
import { XSS_CORPUS } from "./xss-corpus.ts";

for (const c of XSS_CORPUS) {
  test(`xss: ${c.name}`, () => {
    const html = renderMarkdown(c.markdown).toLowerCase();
    for (const bad of c.absent) expect(html, `should not contain ${bad}`).not.toContain(bad.toLowerCase());
    for (const good of c.present) expect(html, `should contain ${good}`).toContain(good.toLowerCase());
  });
}

test("no element in any corpus output carries an event handler, a style, or a bad link", () => {
  for (const c of XSS_CORPUS) {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(c.markdown);
    for (const el of root.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith("on"), `${c.name}: ${attr}`).toBe(false);
        expect(attr, c.name).not.toBe("style");
      }
      const href = el.getAttribute("href");
      if (href !== null) expect(href, c.name).toMatch(/^(https?:|mailto:|#|\/|[^:]*$)/i);
    }
  }
});

test("every link opens in a new tab without an opener", () => {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown("[a](https://example.com) [b](#top) [c](/rel) <a href=\"mailto:x@example.com\">d</a>");
  const links = [...root.querySelectorAll("a")];
  expect(links).toHaveLength(4);
  for (const link of links) {
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

test("safe links and relative paths keep their href", () => {
  const html = renderMarkdown("[a](https://example.com/x) [b](mailto:a@b.co) [c](#frag) [d](docs/a.md)");
  for (const href of ["https://example.com/x", "mailto:a@b.co", "#frag", "docs/a.md"]) {
    expect(html).toContain(`href="${href}"`);
  }
});

test("ordinary markdown renders", () => {
  const html = renderMarkdown("# Title\n\n- one\n- two\n\n`code`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nlet x = 1;\n```\n");
  expect(html).toContain("<h1");
  expect(html).toContain("<li>one</li>");
  expect(html).toContain("<code>code</code>");
  expect(html).toContain("<table>");
  expect(html).toContain('class="language-ts"');
});

test("the sanitizer hook is on its own instance, not the global one", async () => {
  const { default: global } = await import("dompurify");
  const html = global.sanitize('<a href="https://example.com">x</a>');
  expect(html).not.toContain("noopener");
});
