import { LIVE_OUTPUT_CHARS, type ChatMessage, type ToolBlock } from "@golem/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { expect, test } from "vitest";
import { ToolLine, TranscriptColumn, TranscriptMessages } from "./transcript.tsx";
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
  expect(screen.getByText("0m 04.2s · 1 tool")).toBeTruthy();
});

test("the duration line has no tool count when there are no tools, and says 1m 03.0s", () => {
  render(<TranscriptMessages chat={chat([answer({ durationMs: 63_000 })])} />);
  expect(screen.getByText("1m 03.0s")).toBeTruthy();
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
  expect(screen.getAllByRole("button")).toHaveLength(5);
});

test("the chat's error and notice close the transcript", () => {
  render(<TranscriptMessages chat={chat([answer()], { error: "It broke", notice: "Saved" })} />);
  expect(screen.getByRole("alert").textContent).toBe("It broke");
  expect(screen.getByRole("status").textContent).toBe("Saved");
});

test("a tool call the model wrote as text shows the notice with the Tune tab", () => {
  render(<TranscriptMessages chat={{ ...chat([answer()]), unreadCall: true }} />);
  expect(screen.getByRole("status").textContent).toBe(
    "The model wrote a tool call as text, and golem couldn't read it. Ask again, or try the Tune tab → precise (a lower temperature makes this rarer).",
  );
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

const tool = (over: Partial<ToolBlock> = {}): ToolBlock => ({ callId: "t", name: "run_shell", args: { command: "ls -la" }, status: "running", ...over });
const renderTool = (block: ToolBlock) => render(<ul><ToolLine tool={block} /></ul>);
const line = () => screen.getByRole("button");

test("each status shows its result, the done one in allow", () => {
  const view = renderTool(tool({ status: "done", summary: "41 lines" }));
  expect(line().textContent).toContain("✓ 41 lines");
  expect(line().querySelector(".text-allow")?.textContent).toContain("41 lines");
  view.unmount();
  renderTool(tool({ status: "waiting" }));
  expect(line().textContent).toContain("waiting for you");
  expect(line().querySelector(".text-wait")).toBeTruthy();
});

test("a failed line shows the error cut to fit, in deny", () => {
  renderTool(tool({ status: "failed", error: "denied" }));
  expect(line().textContent).toContain("✗ denied");
  expect(line().querySelector(".truncate.text-deny")).toBeTruthy();
});

test("the line opens and closes its tablet by click and by Enter", () => {
  renderTool(tool({ status: "waiting", args: { command: "ls", all: true } }));
  expect(line().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/"all": true/)).toBeNull();
  fireEvent.click(line());
  expect(line().getAttribute("aria-expanded")).toBe("true");
  const tablet = document.getElementById(line().getAttribute("aria-controls") ?? "");
  expect(tablet?.textContent).toContain('"all": true');
  expect(tablet?.textContent).not.toContain("output");
  fireEvent.click(line());
  expect(line().getAttribute("aria-expanded")).toBe("false");
  expect(document.getElementById(tablet?.id ?? "")).toBeNull();
});

test("Enter on the focused line toggles it", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  renderTool(tool());
  line().focus();
  await user.keyboard("{Enter}");
  expect(line().getAttribute("aria-expanded")).toBe("true");
  await user.keyboard(" ");
  expect(line().getAttribute("aria-expanded")).toBe("false");
});

test("running output updates live, says when there is none, and notes cut output", () => {
  const view = renderTool(tool());
  fireEvent.click(line());
  expect(screen.getByText("no output yet")).toBeTruthy();
  view.rerender(<ul><ToolLine tool={tool({ output: "one" })} /></ul>);
  expect(screen.getByText("one")).toBeTruthy();
  expect(screen.queryByText(/Earlier output/)).toBeNull();
  view.rerender(<ul><ToolLine tool={tool({ output: "one\ntwo" })} /></ul>);
  expect(screen.getByText(/one\s+two/)).toBeTruthy();
  view.rerender(<ul><ToolLine tool={tool({ output: "x".repeat(LIVE_OUTPUT_CHARS) })} /></ul>);
  expect(screen.getByText(/Earlier output is not shown/)).toBeTruthy();
});

test("a done tool shows its preview, and the cut and artifact notes", () => {
  renderTool(tool({ status: "done", summary: "ok", preview: "hello", truncated: true, artifactId: "art_1" }));
  fireEvent.click(line());
  expect(screen.getByText("hello")).toBeTruthy();
  expect(screen.getByText("The output was cut.")).toBeTruthy();
  expect(screen.getByText("The whole output is saved as artifact art_1.")).toBeTruthy();
});

test("a failed tool shows the whole error in the tablet", () => {
  const error = `${"boom ".repeat(60)}end`;
  renderTool(tool({ status: "failed", error }));
  fireEvent.click(line());
  const pre = document.querySelector("pre.text-deny");
  expect(pre?.textContent).toBe(error);
});

test("hostile output is text, never an element", () => {
  const evil = "<img src=x onerror=alert(1)>";
  renderTool(tool({ status: "done", summary: "ok", preview: evil }));
  fireEvent.click(line());
  expect(screen.getByText(evil)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
});

test("a tool with a diff shows the change first, with the switch", () => {
  renderTool({
    callId: "d",
    name: "edit_file",
    args: { path: "a.ts" },
    status: "waiting",
    diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-one\n+two\n",
  });
  fireEvent.click(screen.getByRole("button", { name: /edit_file/ }));
  expect(screen.getByText("change")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Change to a.ts" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Split" })).toBeTruthy();
  const labels = Array.from(document.querySelectorAll(".tool-tablet section > p, .tool-tablet section > div > p")).map((p) => p.textContent);
  expect(labels.indexOf("change")).toBeLessThan(labels.indexOf("arguments"));
});

test("a finished git_diff shows its preview as a diff", () => {
  renderTool({
    callId: "g",
    name: "git_diff",
    args: {},
    status: "done",
    summary: "1 file",
    preview: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-one\n+two\n",
  });
  fireEvent.click(screen.getByRole("button", { name: /git_diff/ }));
  expect(screen.getByRole("table", { name: "Change to a.ts" })).toBeTruthy();
});

test("a tool without a diff shows no change section", () => {
  renderTool({ callId: "r", name: "read_file", args: {}, status: "done", summary: "1 line", preview: "x" });
  fireEvent.click(screen.getByRole("button", { name: /read_file/ }));
  expect(screen.queryByText("change")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});

test("an answer after thinking has one line that opens to the thinking text and closes again", () => {
  const { container } = render(
    <TranscriptMessages
      chat={chat([answer({ text: "391", thinking: "17 times 23 is 391.", thinkingMs: 12_400 })])}
    />,
  );
  const control = screen.getByRole("button", { name: /thought for 12s/ });
  expect(control.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("17 times 23 is 391.")).toBeNull();
  fireEvent.click(control);
  expect(control.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("region", { name: "Thinking" }).textContent).toBe("17 times 23 is 391.");
  fireEvent.click(control);
  expect(screen.queryByText("17 times 23 is 391.")).toBeNull();
  // The line comes before the answer text.
  const line = container.querySelector("[data-thinking]");
  const text = container.querySelector(".prose");
  expect(line && text && line.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a streaming reply says thinking, and an answer without thinking has no line", () => {
  render(<TranscriptMessages chat={chat([answer({ streaming: true, text: "", thinking: "hm" })])} />);
  expect(screen.getByRole("button", { name: /thinking…/ })).toBeTruthy();
});

test("no thinking, no thinking line", () => {
  const { container } = render(<TranscriptMessages chat={chat([answer()])} />);
  expect(container.querySelector("[data-thinking]")).toBeNull();
});

test("the thinking control passes axe closed and open", async () => {
  const { container } = render(
    <TranscriptMessages chat={chat([answer({ text: "391", thinking: "step one\nstep two", thinkingMs: 3000 })])} />,
  );
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /thought for 3s/ }));
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
