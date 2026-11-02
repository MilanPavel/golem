import { render, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { Markdown } from "./markdown-view.tsx";
import { XSS_CORPUS } from "./xss-corpus.ts";

test("the hostile corpus renders without a script, a handler, or a bad link in the page", () => {
  for (const c of XSS_CORPUS) {
    const { container, unmount } = render(<Markdown text={c.markdown} />);
    expect(container.querySelector("script, iframe, style, svg, math, form, input, img, base, meta, link"), c.name).toBeNull();
    for (const el of container.querySelectorAll("*")) {
      expect(el.getAttributeNames().some((a) => a.startsWith("on") || a === "style"), c.name).toBe(false);
      expect(el.getAttribute("href") ?? "", c.name).not.toMatch(/^\s*(javascript|data|vbscript|file):/i);
    }
    for (const good of c.present) expect(container.textContent?.toLowerCase(), c.name).toContain(good.toLowerCase());
    unmount();
  }
});

test("a finished answer's known code block gets coloured spans, and the text is unchanged", async () => {
  const code = "const a = 1;\nreturn a;";
  const { container } = render(<Markdown text={"```ts\n" + code + "\n```"} />);
  const block = container.querySelector("pre > code") as HTMLElement;
  await waitFor(() => expect(block.dataset["highlighted"]).toBe("true"), { timeout: 10_000 });
  expect(block.querySelectorAll("span").length).toBeGreaterThan(2);
  expect([...block.children].every((child) => child.tagName === "SPAN")).toBe(true);
  expect([...block.querySelectorAll<HTMLElement>("span")].some((s) => s.style.color.includes("--shiki-token"))).toBe(true);
  expect(block.textContent).toBe(code);
});

test("a streaming answer's code block stays plain", async () => {
  const { container } = render(<Markdown text={"```ts\nconst a = 1;\n```"} streaming />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const block = container.querySelector("pre > code") as HTMLElement;
  expect(block.querySelectorAll("span")).toHaveLength(0);
  expect(block.dataset["highlighted"]).toBeUndefined();
});

test("an unknown language stays plain", async () => {
  const { container } = render(<Markdown text={"```klingon\nqapla\n```"} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const block = container.querySelector("pre > code") as HTMLElement;
  expect(block.querySelectorAll("span")).toHaveLength(0);
  expect(block.textContent).toBe("qapla\n");
});

test("markup in code stays text after highlighting", async () => {
  const { container } = render(<Markdown text={'```html\n<img src=x onerror="alert(1)">\n```'} />);
  const block = container.querySelector("pre > code") as HTMLElement;
  await waitFor(() => expect(block.dataset["highlighted"]).toBe("true"), { timeout: 10_000 });
  expect(block.querySelector("img")).toBeNull();
  expect(block.textContent).toContain('<img src=x onerror="alert(1)">');
});
