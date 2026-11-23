import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { detailStore, footerStore, sendKeyStore, thinkingModeStore } from "../chat/index.ts";
import { ChatSection } from "./chat-section.tsx";
import { searchSettings } from "./settings-search.ts";

function reset(): void {
  localStorage.clear();
  detailStore.set("normal");
  thinkingModeStore.set("collapsed");
  footerStore.set({ off: [], leaveOutEmpty: true });
  sendKeyStore.set("enter");
}
beforeEach(reset);
afterEach(reset);

const shown = () => screen.getByRole("list", { name: "What you see" });
const footerLine = () => shown().querySelector("[data-footer-line]")?.textContent ?? "";
const mount = () => render(<ChatSection instructions={<p>instructions</p>} alone={<p>alone</p>} />);

test("the page has three numbered stages in order, with the you bubble between the first two", () => {
  const { container } = mount();
  const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
  expect(headings).toEqual([
    "Before you writegolem puts these lines in every chat, word for word",
    "While it workshow far it goes before it checks with you",
    "What you seeonly this screen, saved on this device; the answer does not change",
  ]);
  const bubble = screen.getByText("Plan a weekend in Porto and save it to my notes");
  expect(bubble.closest("[aria-hidden=true]")).not.toBeNull();
  const order = [...container.querySelectorAll("section, [aria-hidden=true]")].map((node) => node.textContent ?? "");
  expect(order.findIndex((text) => text.includes("Plan a weekend"))).toBeGreaterThan(order.findIndex((text) => text.startsWith("Before")));
  expect(screen.queryByText(/Open it when a step fails/)).toBeNull();
  expect(screen.queryByText(/One step failed/)).toBeNull();
});

test("stage 3 shows today's values", () => {
  mount();
  expect(screen.getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Collapsed" }).getAttribute("aria-checked")).toBe("true");
  for (const name of ["Time", "Steps", "Model", "Local or hosted", "Tokens", "Helpers"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
  }
  expect((screen.getByRole("checkbox", { name: /Leave out what says nothing/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("radio", { name: "Enter" }).getAttribute("aria-checked")).toBe("true");
});

test("Steps changes the sample and is kept as golem.detail", async () => {
  const user = userEvent.setup();
  mount();
  expect(within(shown()).getByText(/searched the web/)).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Quiet" }));
  expect(localStorage.getItem("golem.detail")).toBe("quiet");
  expect(within(shown()).getByRole("button", { name: "5 steps" })).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Verbose" }));
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
  expect(within(shown()).getByRole("list", { name: "Tool calls" })).toBeTruthy();
});

test("the arrow keys move between the Steps choices", async () => {
  const user = userEvent.setup();
  mount();
  screen.getByRole("radio", { name: "Normal" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
});

test("Thinking has three choices; Hidden shows a placeholder and Open shows the text", async () => {
  const user = userEvent.setup();
  mount();
  const line = () => within(shown()).queryByRole("button", { name: /thought for 3s/ });
  expect(line()?.getAttribute("aria-expanded")).toBe("false");
  await user.click(screen.getByRole("radio", { name: "Open" }));
  expect(localStorage.getItem("golem.thinking")).toBe("open");
  expect(within(shown()).getByRole("region", { name: "Thinking" }).textContent).toContain("Two days.");
  await user.click(screen.getByRole("radio", { name: "Hidden" }));
  expect(localStorage.getItem("golem.thinking")).toBe("hidden");
  expect(line()).toBeNull();
  expect(within(shown()).getByText("thinking is hidden")).toBeTruthy();
});

test("clicking a part changes the line above it and is kept as golem.footer", async () => {
  const user = userEvent.setup();
  mount();
  expect(footerLine()).toBe("1m 12s · 5 steps · qwen3.8:27b · local · 38.4K tok · 1 helper · ↑ stronger model");
  await user.click(screen.getByRole("button", { name: "Tokens" }));
  expect(footerLine()).toBe("1m 12s · 5 steps · qwen3.8:27b · local · 1 helper · ↑ stronger model");
  const tokens = screen.getByRole("button", { name: "Tokens" });
  expect(tokens.getAttribute("aria-pressed")).toBe("false");
  expect(tokens.textContent).toBe("Tokens");
  expect(JSON.parse(localStorage.getItem("golem.footer") ?? "{}")).toEqual({ off: ["tokens"], leaveOutEmpty: true });
  await user.click(tokens);
  expect(footerLine()).toContain("38.4K tok");
});

test("with Leave out what says nothing on, Cost is struck through for the local sample", async () => {
  const user = userEvent.setup();
  mount();
  const cost = screen.getByRole("button", { name: "Cost" });
  expect(cost.getAttribute("data-left-out")).toBe("true");
  expect(cost.getAttribute("title")).toMatch(/says nothing/);
  expect(footerLine()).not.toContain("$0.00");
  await user.click(screen.getByRole("checkbox", { name: /Leave out what says nothing/ }));
  expect(cost.getAttribute("data-left-out")).toBeNull();
  expect(footerLine()).toContain("$0.00");
});

test("Send with changes the hint in the sample composer and is kept as golem.sendKey", async () => {
  const user = userEvent.setup();
  mount();
  expect(within(shown()).getByText("↵ send · ⇧↵ new line")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: /Enter$/, checked: false }));
  expect(localStorage.getItem("golem.sendKey")).toBe("mod");
  expect(within(shown()).getByText(/send · ↵ new line$/)).toBeTruthy();
  act(() => sendKeyStore.set("enter"));
});

test("every row keeps its data-setting", () => {
  mount();
  for (const setting of ["thinking", "steps", "footer", "send"]) {
    expect(shown().querySelector(`[data-setting="${setting}"]`), setting).not.toBeNull();
  }
});

test("search finds steps, thinking, footer and send on the Chat page", () => {
  for (const word of ["steps", "thinking", "footer", "send"]) {
    expect(searchSettings(word).some((hit) => hit.section.id === "chat"), word).toBe(true);
  }
  expect(searchSettings("open it when a step fails").some((hit) => hit.section.id === "chat")).toBe(false);
});
