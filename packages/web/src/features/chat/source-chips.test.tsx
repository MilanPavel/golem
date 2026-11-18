import type { TurnSource } from "@golem/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Markdown, CARD_GRACE_MS } from "./markdown-view.tsx";
import { NOT_READ_WARNING } from "./source-card.tsx";
import { TurnSources } from "./sources-list.tsx";
import { withoutOpenLink } from "./chips.ts";

const ARGUS: TurnSource = {
  url: "https://arxiv.org/abs/2611.04121",
  title: "Argus: A Runtime for Long-Horizon Agent Tasks",
  snippet: "We present Argus, a runtime that composes tools.",
  kind: "read",
  at: "2026-11-18T14:02:00Z",
};
const JIUWEN: TurnSource = { url: "https://arxiv.org/abs/2611.03377", title: "openJiuwen", snippet: "Harness changes lift SWE-bench.", kind: "read" };
const PAPERS: TurnSource = { url: "https://papers.cool/arxiv/cs.AI", title: "cs.AI feed", snippet: "Daily listing.", kind: "search" };
const SOURCES = [ARGUS, JIUWEN, PAPERS];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chips(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".src-chip")];
}

test("a link to a turn source becomes a chip with a letter mark and a short label", () => {
  const { container } = render(<Markdown text="Argus is general [arXiv](https://arxiv.org/abs/2611.04121)." sources={SOURCES} />);
  const [chip] = chips(container);
  expect(chip?.tagName).toBe("A");
  expect(chip?.classList.contains("src-chip-unread")).toBe(false);
  expect(chip?.querySelector(".src-mark")?.textContent).toBe("A");
  expect(chip?.querySelector(".src-label")?.textContent).toBe("arXiv");
  expect(chip?.getAttribute("aria-label")).toBe("Source: arxiv.org, Argus: A Runtime for Long-Horizon Agent Tasks");
  expect(chip?.getAttribute("href")).toBe("https://arxiv.org/abs/2611.04121");
  expect(chip?.getAttribute("rel")).toBe("noopener noreferrer");
});

test("a long link text gives the host as the label", () => {
  const { container } = render(<Markdown text="[Argus: A Runtime for Long-Horizon Agent Tasks](https://www.papers.cool/x)" sources={SOURCES} />);
  expect(chips(container)[0]?.querySelector(".src-label")?.textContent).toBe("papers.cool");
});

test("chips side by side merge into one with +N", () => {
  const { container } = render(
    <Markdown text="Both agree [openJiuwen](https://arxiv.org/abs/2611.03377), [Argus](https://arxiv.org/abs/2611.04121) and more." sources={SOURCES} />,
  );
  const found = chips(container);
  expect(found).toHaveLength(1);
  expect(found[0]?.querySelector(".src-more")?.textContent).toBe("+1");
  expect(found[0]?.textContent).toContain("openJiuwen");
  expect(container.textContent).toContain("Both agree");
  expect(container.textContent).toContain("and more.");
});

test("chips with words between them stay apart", () => {
  const { container } = render(
    <Markdown text="One [A](https://arxiv.org/abs/2611.03377) then another claim [B](https://arxiv.org/abs/2611.04121)." sources={SOURCES} />,
  );
  expect(chips(container)).toHaveLength(2);
});

test("a link the turn never found or read is a dashed not-read chip", () => {
  const { container } = render(<Markdown text="A blog [harness hype](https://example-ml-blog.net/x) says no." sources={SOURCES} />);
  const [chip] = chips(container);
  expect(chip?.classList.contains("src-chip-unread")).toBe(true);
  expect(chip?.getAttribute("aria-label")).toContain("Not read, example-ml-blog.net");
});

test("only http and https links become chips", () => {
  const { container } = render(<Markdown text={"[mail](mailto:a@b.c) [frag](#x) [rel](/path) [js](javascript:alert(1))"} sources={SOURCES} />);
  expect(chips(container)).toHaveLength(0);
});

test("without sources, links stay plain links", () => {
  const { container } = render(<Markdown text="[docs](https://example.com/docs)" />);
  expect(chips(container)).toHaveLength(0);
  expect(container.querySelector("a")?.textContent).toBe("docs");
});

test("an open link is never shown while streaming, and a faded chip stands in", () => {
  const { container, rerender } = render(<Markdown text="Claim one [arXiv](https://arxiv.org/abs/2611.0" streaming sources={SOURCES} />);
  expect(container.textContent).not.toContain("](");
  expect(container.textContent).not.toContain("https://");
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector("[data-pending]")).not.toBeNull();
  rerender(<Markdown text="Claim one [arXiv](https://arxiv.org/abs/2611.04121)" streaming sources={SOURCES} />);
  expect(container.querySelector("[data-pending]")).toBeNull();
  expect(chips(container)).toHaveLength(1);
});

test("withoutOpenLink cuts an open link only", () => {
  expect(withoutOpenLink("a [b](https://x.y/z", false)).toEqual({ text: "a", cut: true });
  expect(withoutOpenLink("a [b](https://x.y/z) done", false)).toEqual({ text: "a [b](https://x.y/z) done", cut: false });
  expect(withoutOpenLink("a [b", false).cut).toBe(false);
  expect(withoutOpenLink("a [b", true)).toEqual({ text: "a", cut: true });
});

test("focusing a chip opens its card, and Escape closes it and puts the focus back", () => {
  const { container } = render(<Markdown text="Claim [arXiv](https://arxiv.org/abs/2611.04121)." sources={SOURCES} />);
  const chip = chips(container)[0] as HTMLElement;
  act(() => {
    chip.focus();
  });
  const card = screen.getByRole("dialog", { name: "Source" });
  expect(card.textContent).toContain("Argus: A Runtime for Long-Horizon Agent Tasks");
  expect(card.textContent).toContain("We present Argus");
  expect(card.textContent).toContain("read");
  expect(card.textContent).toContain("Copy link");
  expect(card.textContent).toContain("Open ↗");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Source" })).toBeNull();
  expect(document.activeElement).toBe(chip);
});

test("hovering opens the card, leaving closes it after a short grace", () => {
  vi.useFakeTimers();
  const { container } = render(<Markdown text="Claim [feed](https://papers.cool/arxiv/cs.AI)." sources={SOURCES} />);
  const chip = chips(container)[0] as HTMLElement;
  fireEvent.mouseOver(chip);
  expect(screen.getByRole("dialog", { name: "Source" }).textContent).toContain("search hit");
  fireEvent.mouseOut(chip);
  act(() => {
    vi.advanceTimersByTime(CARD_GRACE_MS - 20);
  });
  expect(screen.queryByRole("dialog", { name: "Source" })).not.toBeNull();
  fireEvent.mouseEnter(screen.getByRole("dialog", { name: "Source" }));
  act(() => {
    vi.advanceTimersByTime(CARD_GRACE_MS * 2);
  });
  expect(screen.queryByRole("dialog", { name: "Source" })).not.toBeNull();
  fireEvent.mouseLeave(screen.getByRole("dialog", { name: "Source" }));
  act(() => {
    vi.advanceTimersByTime(CARD_GRACE_MS + 10);
  });
  expect(screen.queryByRole("dialog", { name: "Source" })).toBeNull();
});

test("the card of a merged chip pages with the arrows", () => {
  const { container } = render(
    <Markdown text="Both [A](https://arxiv.org/abs/2611.03377) [B](https://arxiv.org/abs/2611.04121)." sources={SOURCES} />,
  );
  fireEvent.mouseOver(chips(container)[0] as HTMLElement);
  expect(screen.getByRole("dialog").textContent).toContain("openJiuwen");
  expect(screen.getByRole("dialog").textContent).toContain("1/2");
  fireEvent.click(screen.getByRole("button", { name: "Next source" }));
  expect(screen.getByRole("dialog").textContent).toContain("Argus: A Runtime");
  expect(screen.getByRole("dialog").textContent).toContain("2/2");
});

test("the card of a not-read link carries the warning", () => {
  const { container } = render(<Markdown text="[blog](https://example-ml-blog.net/harness-hype)" sources={SOURCES} />);
  fireEvent.mouseOver(chips(container)[0] as HTMLElement);
  const card = screen.getByRole("dialog", { name: "Source" });
  expect(card.textContent).toContain(NOT_READ_WARNING);
  expect(card.textContent).toContain("not read");
});

test("on a narrow screen a tap opens a sheet and does not follow the link", () => {
  vi.stubGlobal("innerWidth", 390);
  const { container } = render(<Markdown text="Claim [arXiv](https://arxiv.org/abs/2611.04121)." sources={SOURCES} />);
  const chip = chips(container)[0] as HTMLElement;
  fireEvent.mouseOver(chip);
  expect(screen.queryByRole("dialog")).toBeNull();
  const notPrevented = fireEvent.click(chip);
  expect(notPrevented).toBe(false);
  expect(screen.getByRole("dialog", { name: "Sources" }).textContent).toContain("Argus: A Runtime");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a hostile title, snippet, and link text stay text", () => {
  const evil: TurnSource = {
    url: "https://evil.example/x",
    title: '<img src=x onerror="alert(1)">Title',
    snippet: "<script>alert(2)</script><b>bold</b>",
    kind: "read",
  };
  const { container } = render(<Markdown text={'[<img src=x onerror="alert(3)">](https://evil.example/x)'} sources={[evil]} />);
  fireEvent.mouseOver(chips(container)[0] as HTMLElement);
  expect(document.body.querySelector("script, img, b")).toBeNull();
  const card = screen.getByRole("dialog", { name: "Source" });
  expect(card.textContent).toContain('<img src=x onerror="alert(1)">Title');
  expect(card.textContent).toContain("<script>alert(2)</script><b>bold</b>");
  for (const el of document.body.querySelectorAll("*")) {
    expect(el.getAttributeNames().some((a) => a.startsWith("on")), el.outerHTML).toBe(false);
  }
});

test("the Sources button counts the pages and the list filters Cited and All", () => {
  const answer = "Claim [arXiv](https://arxiv.org/abs/2611.04121) and again [Argus](https://arxiv.org/abs/2611.04121/) and [J](https://arxiv.org/abs/2611.03377).";
  render(<TurnSources sources={SOURCES} answer={answer} />);
  const button = screen.getByRole("button", { name: /3 sources/ });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("region", { name: "Sources" })).toBeNull();
  fireEvent.click(button);
  const list = screen.getByRole("region", { name: "Sources" });
  expect(screen.getByRole("button", { name: "Cited · 2" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "All · 3" })).not.toBeNull();
  expect(list.querySelectorAll("li")).toHaveLength(2);
  expect(list.textContent).toContain("cited 2×");
  expect(list.textContent).toContain("cited 1×");
  expect(list.textContent).not.toContain("cs.AI feed");
  fireEvent.click(screen.getByRole("button", { name: "All · 3" }));
  expect(list.querySelectorAll("li")).toHaveLength(3);
  expect(list.textContent).toContain("not cited");
  expect(list.textContent).toContain("search hit");
  expect(list.textContent).toContain("arxiv.org/abs/2611.04121");
});

test("no sources, no button", () => {
  const { container } = render(<TurnSources sources={[]} answer="" />);
  expect(container.innerHTML).toBe("");
});
