import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { detailStore, footerStore, openOnFailStore, sendKeyStore, thinkingModeStore } from "../chat/index.ts";
import { ChatSection } from "./chat-section.tsx";
import { searchSettings } from "./settings-search.ts";

function reset(): void {
  localStorage.clear();
  detailStore.set("normal");
  thinkingModeStore.set("collapsed");
  openOnFailStore.set(true);
  footerStore.set({ off: [], leaveOutEmpty: true });
  sendKeyStore.set("enter");
}
beforeEach(reset);
afterEach(reset);

const preview = () => screen.getByRole("group", { name: "Preview" });

test("the page shows the Steps, thinking, line, and send choices with today's values", () => {
  render(<ChatSection instructions={null} alone={null} />);
  expect(screen.getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("switch", { name: "Open it when a step fails" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Collapsed" }).getAttribute("aria-checked")).toBe("true");
  for (const name of ["Time", "Steps", "Model", "Local or hosted", "Tokens", "Cost", "Helpers"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
  }
  expect((screen.getByRole("checkbox", { name: /Leave out what says nothing/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("radio", { name: "Enter" }).getAttribute("aria-checked")).toBe("true");
});

test("Steps changes the preview and is kept as golem.detail", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  expect(within(preview()).getByText(/searched the web/)).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Quiet" }));
  expect(localStorage.getItem("golem.detail")).toBe("quiet");
  expect(within(preview()).getByText("5 steps")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Verbose" }));
  expect(within(preview()).getByRole("list", { name: "Tool calls" })).toBeTruthy();
});

test("the arrow keys move between the Steps choices", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  screen.getByRole("radio", { name: "Normal" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
});

test("One step failed opens the steps in Quiet, and turning the choice off folds them", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  await user.click(screen.getByRole("radio", { name: "Quiet" }));
  expect(within(preview()).queryByRole("list", { name: "Tool calls" })).toBeNull();
  await user.click(within(preview()).getByRole("switch", { name: "One step failed" }));
  expect(within(preview()).getByRole("list", { name: "Tool calls" })).toBeTruthy();
  await user.click(screen.getByRole("switch", { name: "Open it when a step fails" }));
  expect(localStorage.getItem("golem.openOnFail")).toBe("off");
  expect(within(preview()).queryByRole("list", { name: "Tool calls" })).toBeNull();
});

test("Thinking has three choices and the preview follows them", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  const line = () => within(preview()).queryByRole("button", { name: /thought for 3s/ });
  expect(line()?.getAttribute("aria-expanded")).toBe("false");
  await user.click(screen.getByRole("radio", { name: "Open" }));
  expect(localStorage.getItem("golem.thinking")).toBe("open");
  expect(within(preview()).getByRole("region", { name: "Thinking" }).textContent).toContain("Two days.");
  await user.click(screen.getByRole("radio", { name: "Hidden" }));
  expect(localStorage.getItem("golem.thinking")).toBe("hidden");
  expect(line()).toBeNull();
});

test("a part turned off leaves the line under the answer, and the checkbox drops what says nothing", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  const line = () => preview().querySelector("article > p:last-child")?.textContent ?? "";
  expect(line()).toBe("1m 12s · 5 steps · qwen3.8:27b · local · 38.4K tok · 1 helper");
  await user.click(screen.getByRole("button", { name: "Tokens" }));
  expect(line()).toBe("1m 12s · 5 steps · qwen3.8:27b · local · 1 helper");
  expect(JSON.parse(localStorage.getItem("golem.footer") ?? "{}")).toEqual({ off: ["tokens"], leaveOutEmpty: true });
  await user.click(screen.getByRole("checkbox", { name: /Leave out what says nothing/ }));
  expect(line()).toContain("$0.00");
});

test("Send with changes the hint in the preview", async () => {
  const user = userEvent.setup();
  render(<ChatSection instructions={null} alone={null} />);
  expect(within(preview()).getByText("↵ send · ⇧↵ new line")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: /Enter$/, checked: false }));
  expect(localStorage.getItem("golem.sendKey")).toBe("mod");
  expect(within(preview()).getByText(/send · ↵ new line$/)).toBeTruthy();
  act(() => sendKeyStore.set("enter"));
});

test("search finds steps, thinking, footer and send on the Chat page", () => {
  for (const word of ["steps", "thinking", "footer", "send"]) {
    expect(searchSettings(word).some((hit) => hit.section.id === "chat"), word).toBe(true);
  }
});
