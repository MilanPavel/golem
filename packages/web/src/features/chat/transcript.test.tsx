import type { ChatMessage } from "@golem/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { expect, test } from "vitest";
import { TranscriptColumn, TranscriptMessages } from "./transcript.tsx";
import { SAMPLE_CHAT } from "./sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const chat = (messages: ChatMessage[], extra: { error?: string | null; notice?: string | null } = {}) => ({
  messages,
  error: extra.error ?? null,
  notice: extra.notice ?? null,
});
const answer = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: "a", role: "assistant", text: "Hi", streaming: false, ...over });
const golemState = (container: HTMLElement) => container.querySelector("svg[data-state]")?.getAttribute("data-state");

test("an empty session says so", () => {
  render(<TranscriptMessages chat={chat([])} />);
  expect(screen.getByText("No messages yet.")).toBeTruthy();
});

test("a user message is a slip with the time and, for a skill, a chip", () => {
  const { container } = render(
    <TranscriptMessages
      chat={chat([{ id: "u", role: "user", text: "Hello there", streaming: false, at: "2026-11-01T14:02:00", skill: { name: "ship" } }])}
    />,
  );
  const you = screen.getByRole("article", { name: "You" });
  expect(within(you).getByText("Hello there")).toBeTruthy();
  expect(within(you).getByText("ship")).toBeTruthy();
  expect(within(you).getByText("14:02")).toBeTruthy();
  expect(container.querySelector(".bg-slip")).toBeTruthy();
});

test("a finished answer: idle golem, markdown, duration and tool count, no cursor", () => {
  const { container } = render(
    <TranscriptMessages
      chat={chat([
        answer({
          text: "Some **bold** text",
          durationMs: 4200,
          tools: [{ callId: "t", name: "grep", args: { pattern: "x" }, status: "done", summary: "2 matches" }],
        }),
      ])}
    />,
  );
  expect(container.querySelector(".prose strong")?.textContent).toBe("bold");
  expect(golemState(container)).toBe("idle");
  expect(container.querySelector("[data-cursor]")).toBeNull();
  expect(screen.getByText("4.2s · 1 tool")).toBeTruthy();
});

test("the duration line has no tool count when there are no tools, and says 1m 03s", () => {
  render(<TranscriptMessages chat={chat([answer({ durationMs: 63_000 })])} />);
  expect(screen.getByText("1m 03s")).toBeTruthy();
});

test("a streaming answer has the cursor, a thinking golem, and no footer", () => {
  const { container } = render(<TranscriptMessages chat={chat([answer({ streaming: true, text: "Typing", durationMs: 100 })])} />);
  expect(container.querySelector("[data-cursor]")).toBeTruthy();
  expect(golemState(container)).toBe("thinking");
  expect(screen.queryByText("0.1s")).toBeNull();
});

test("an answer with a tool waiting has the waiting golem", () => {
  const { container } = render(
    <TranscriptMessages
      chat={chat([answer({ streaming: true, tools: [{ callId: "t", name: "run", args: {}, status: "waiting" }] })])}
    />,
  );
  expect(golemState(container)).toBe("waiting");
});

test("an interrupted answer ends with stopped", () => {
  render(<TranscriptMessages chat={chat([answer({ interrupted: true })])} />);
  expect(screen.getByText("stopped")).toBeTruthy();
});

test("each tool status reads its own way, and long arguments keep their full text in the title", () => {
  const long = "x".repeat(300);
  render(
    <TranscriptMessages
      chat={chat([
        answer({
          tools: [
            { callId: "1", name: "read_file", args: { path: long }, status: "done", summary: "41 lines" },
            { callId: "2", name: "run", args: { command: "ls" }, status: "waiting" },
            { callId: "3", name: "run", args: { command: "ls" }, status: "running" },
            { callId: "4", name: "run", args: { command: "ls" }, status: "requested" },
            { callId: "5", name: "write_file", args: { path: "a" }, status: "failed", error: "denied" },
          ],
        }),
      ])}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items.map((i) => i.getAttribute("data-tool-status"))).toEqual(["done", "waiting", "running", "requested", "failed"]);
  expect(items[0]?.textContent).toContain("✓ 41 lines");
  expect(items[0]?.querySelector('[title^="xxxx"]')?.getAttribute("title")).toBe(long);
  expect(items[1]?.textContent).toContain("waiting for you");
  expect(items[2]?.textContent).toContain("running…");
  expect(items[4]?.textContent).toContain("✗ denied");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

test("the chat's error and notice close the transcript", () => {
  render(<TranscriptMessages chat={chat([answer()], { error: "It broke", notice: "Saved" })} />);
  expect(screen.getByRole("alert").textContent).toBe("It broke");
  expect(screen.getByRole("status").textContent).toBe("Saved");
});

function setScroll(el: HTMLElement, values: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: values.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: values.clientHeight });
  el.scrollTop = values.scrollTop ?? 0;
}

test("the column follows new text while at the bottom, stays put after scrolling up, and offers a way back", () => {
  const view = render(<TranscriptColumn chat={chat([answer({ text: "one" })])} />);
  const scroller = view.container.querySelector("[data-transcript-scroller]") as HTMLElement;
  setScroll(scroller, { scrollHeight: 1000, clientHeight: 400 });

  // At the bottom (the default): new text scrolls to the end.
  view.rerender(<TranscriptColumn chat={chat([answer({ text: "one two" })])} />);
  expect(scroller.scrollTop).toBe(1000);
  expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();

  // Scroll up: it no longer jumps.
  act(() => {
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
  });
  setScroll(scroller, { scrollHeight: 1200, clientHeight: 400, scrollTop: 100 });
  view.rerender(<TranscriptColumn chat={chat([answer({ text: "one two three" })])} />);
  expect(scroller.scrollTop).toBe(100);

  // The button brings it back and re-pins it.
  fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
  expect(scroller.scrollTop).toBe(1200);
  expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the sample transcript has no accessibility violations in ${theme}`, async () => {
    const { container } = render(
      <section data-theme={theme} aria-label={theme}>
        <TranscriptMessages chat={SAMPLE_CHAT} />
      </section>,
    );
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  });
}
