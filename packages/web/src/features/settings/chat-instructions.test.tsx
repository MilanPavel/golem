import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ChatSuggestionsResult } from "../../store/notifications.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { settingsContextStore } from "./index.ts";
import { searchSettings } from "./settings-search.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const PROMPT = {
  model: "ollama/qwen3",
  parts: [
    { name: "instructions", text: "Be direct.", tokens: 3 },
    { name: "memory", text: "You like metric units.", tokens: 6 },
    { name: "skill_index", text: "Skills: plan a trip.", tokens: 5 },
  ],
  tools_tokens: 100,
  total_tokens: 114,
};

function mount(instructions: string[] = [], suggestions?: ChatSuggestionsResult) {
  history.replaceState(null, "", "/settings/chat");
  const fake = fakeClient();
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.getChat.mockResolvedValue({ instructions, plan_first: false, mode: "balanced" });
  fake.raw.getChatPrompt.mockResolvedValue(PROMPT);
  if (suggestions !== undefined) fake.raw.getChatSuggestions.mockResolvedValue(suggestions);
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", "/Users/you/Documents"));
  });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup(), ...view };
}

const box = (n: number) => screen.findByRole("textbox", { name: `Line ${n}` });
const lastSet = (fake: ReturnType<typeof mount>["fake"]) => fake.raw.setChat.mock.calls.at(-1)?.[0];

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("with no lines it says so, and the meter counts nothing", async () => {
  mount();
  expect(await screen.findByText("No instructions. The model answers in its own style.")).toBeTruthy();
  expect(await screen.findByText(/0 lines · about 3 tokens in every chat/)).toBeTruthy();
});

test("a written line is saved when its box loses focus, and Saved shows", async () => {
  const { fake, user } = mount();
  await screen.findByText("No instructions. The model answers in its own style.");
  await user.click(screen.getByRole("button", { name: "+ Write a line" }));
  const first = await box(1);
  expect(document.activeElement).toBe(first);
  await user.type(first, "  Use metric units.  ");
  expect(fake.raw.setChat).not.toHaveBeenCalled();
  await user.tab();
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["  Use metric units.  "] }));
  expect(await screen.findByText("Saved")).toBeTruthy();
});

test("Enter saves a line", async () => {
  const { fake, user } = mount(["Be direct."]);
  await user.type(await box(1), " Really.{Enter}");
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Be direct. Really."] }));
});

test("✕ saves the list without that line", async () => {
  const { fake, user } = mount(["One.", "Two.", "Three."]);
  await box(1);
  await user.click(screen.getByRole("button", { name: "Remove line 2" }));
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["One.", "Three."] }));
  expect(screen.queryByDisplayValue("Two.")).toBeNull();
});

test("Alt+↓ moves a line down, keeps the focus on it and saves the new order", async () => {
  const { fake, user } = mount(["One.", "Two.", "Three."]);
  const first = await box(1);
  first.focus();
  await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Two.", "One.", "Three."] }));
  expect((document.activeElement as HTMLInputElement).value).toBe("One.");
  await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["One.", "Two.", "Three."] }));
});

test("dragging a line onto another saves the new order", async () => {
  const { fake } = mount(["One.", "Two.", "Three."]);
  await box(1);
  const handle = screen.getByRole("img", { name: "Drag line 1 to move it" });
  const target = (await box(3)).closest("li");
  expect(target).not.toBeNull();
  fireEvent.dragStart(handle);
  fireEvent.dragOver(target!);
  fireEvent.drop(target!);
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Two.", "Three.", "One."] }));
});

test("a refused save shows under the row it names", async () => {
  const { fake, user } = mount(["One.", "Two."]);
  fake.raw.setChat.mockResolvedValueOnce({ ok: false, errors: [{ path: "chat.instructions", message: "line 2 is 400 characters; a line may have at most 300" }] });
  await user.type(await box(2), " more{Enter}");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("line 2 is 400 characters");
  expect((await box(2)).getAttribute("aria-invalid")).toBe("true");
  expect((await box(1)).getAttribute("aria-invalid")).toBeNull();
});

test("Draft lines shows what golem drafted with Add, and hides lines already there", async () => {
  const { fake, user } = mount(["Use metric units."]);
  fake.raw.draftChat.mockResolvedValue({ lines: ["Use metric units.", "Keep it friendly.", "Use short words."], model: "ollama/qwen3" });
  await box(1);
  await user.type(screen.getByRole("textbox", { name: "Describe how you like answers, in your words" }), "simple and friendly");
  await user.click(screen.getByRole("button", { name: "Draft lines" }));
  expect(fake.raw.draftChat).toHaveBeenCalledWith("simple and friendly");
  const drafted = await screen.findByRole("list", { name: "Drafted lines" });
  expect(within(drafted).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Keep it friendly.Add", "Use short words.Add"]);
  await user.click(within(drafted).getByRole("button", { name: "Add “Keep it friendly.”" }));
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Use metric units.", "Keep it friendly."] }));
  expect(within(screen.getByRole("list", { name: "Drafted lines" })).getAllByRole("listitem")).toHaveLength(1);
});

test("Add all adds the drafted lines that are not there yet", async () => {
  const { fake, user } = mount(["Use metric units."]);
  fake.raw.draftChat.mockResolvedValue({ lines: ["Use metric units.", "Keep it friendly.", "Use short words."], model: "m" });
  await box(1);
  await user.type(screen.getByRole("textbox", { name: "Describe how you like answers, in your words" }), "x");
  await user.click(screen.getByRole("button", { name: "Draft lines" }));
  await user.click(await screen.findByRole("button", { name: "Add all" }));
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Use metric units.", "Keep it friendly.", "Use short words."] }));
});

test("the button says Drafting… while it runs, and an error shows under the field", async () => {
  const { fake, user } = mount();
  let fail: (reason: unknown) => void = () => undefined;
  fake.raw.draftChat.mockReturnValue(new Promise((_, reject) => (fail = reject)));
  await screen.findByText("No instructions. The model answers in its own style.");
  const field = screen.getByRole("textbox", { name: "Describe how you like answers, in your words" });
  await user.type(field, "short");
  await user.click(screen.getByRole("button", { name: "Draft lines" }));
  expect(screen.getByRole("button", { name: "Drafting…" })).toBeTruthy();
  await act(async () => {
    fail(rpcError(-32603, "no model is set up"));
  });
  expect((await screen.findByRole("alert")).textContent).toContain("no model is set up");
  expect(screen.getByRole("button", { name: "Draft lines" })).toBeTruthy();
});

const SUGGESTED = {
  suggestions: [
    { line: "Keep answers short.", reason: "You said “shorter” or “tl;dr” in 4 chats this week.", source: "chats" as const },
    { line: "Prefer bullet points.", reason: "From memory: “Prefers bullet points.”", source: "memory" as const },
  ],
  updated: "2026-11-22T08:00:00Z",
  needs_local_model: false,
};

test("From your chats shows each line with its reason, and Add saves it appended", async () => {
  const { fake, user } = mount(["Be direct."], SUGGESTED);
  const list = within(await screen.findByRole("list", { name: "From your chats" }));
  expect(list.getByText("You said “shorter” or “tl;dr” in 4 chats this week.")).toBeTruthy();
  expect(list.getByText("From memory: “Prefers bullet points.”")).toBeTruthy();
  await user.click(list.getByRole("button", { name: "Add “Keep answers short.”" }));
  await waitFor(() => {
    expect(lastSet(fake)).toEqual({ instructions: ["Be direct.", "Keep answers short."] });
  });
  expect(screen.queryByRole("button", { name: "Add “Keep answers short.”" })).toBeNull();
});

test("Not for me sends the dismiss and hides the line", async () => {
  const { fake, user } = mount([], SUGGESTED);
  await user.click(await screen.findByRole("button", { name: "Not for me: “Prefer bullet points.”" }));
  expect(fake.raw.dismissChatSuggestion).toHaveBeenCalledWith("Prefer bullet points.");
  expect(screen.queryByText("Prefer bullet points.")).toBeNull();
  expect(screen.getByText("Keep answers short.")).toBeTruthy();
});

test("with no suggestions it says golem looks once a day", async () => {
  mount();
  expect(await screen.findByText("Nothing yet. golem looks at your chats once a day.")).toBeTruthy();
});

test("without a local model it says it needs one", async () => {
  mount([], { suggestions: [], updated: null, needs_local_model: true });
  expect(await screen.findByText("Needs a local model, because it reads your messages.")).toBeTruthy();
});

test("Common ones is folded, adds a line, and hides a line that is in the list", async () => {
  const { fake, user } = mount(["Use metric units."]);
  await box(1);
  const details = screen.getByText("Common ones").closest("details");
  expect(details?.open).toBe(false);
  const list = within(screen.getByRole("list", { name: "Common ones", hidden: true }));
  expect(list.queryByText("Use metric units.")).toBeNull();
  expect(list.getAllByRole("listitem", { hidden: true })).toHaveLength(7);
  await user.click(screen.getByText("Common ones"));
  await user.click(screen.getByRole("button", { name: "Add “Link the sources you used.”" }));
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Use metric units.", "Link the sources you used."] }));
  expect(screen.queryByRole("button", { name: "Add “Link the sources you used.”" })).toBeNull();
});

test("the bar shows each part with its tokens and the total, and a click shows its text", async () => {
  const { user } = mount(["Be direct."]);
  const preview = await screen.findByRole("group", { name: "What the model reads" });
  const parts = await within(preview).findByRole("list", { name: "Parts" });
  expect(within(parts).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Instructions3", "Memory6", "Skills5", "Tools100"]);
  expect(preview.textContent).toContain("Total: 114 tokens");
  expect(within(preview).getByLabelText("Instructions, as the model reads it").textContent).toBe("Be direct.");
  await user.click(within(parts).getByRole("button", { name: /Memory/ }));
  expect(within(preview).getByLabelText("Memory, as the model reads it").textContent).toBe("You like metric units.");
  expect(screen.getByText(/1 line · about 3 tokens in every chat/)).toBeTruthy();
});

test("it asks again with the unsaved lines, and with the saved ones when they match again", async () => {
  const { fake, user } = mount(["Be direct."]);
  await screen.findByRole("list", { name: "Parts" });
  await waitFor(() => expect(fake.raw.getChatPrompt).toHaveBeenCalledWith({}));
  await user.type(await box(1), " Fast.");
  await waitFor(() => expect(fake.raw.getChatPrompt).toHaveBeenCalledWith({ instructions: ["Be direct. Fast."] }));
  expect(fake.raw.setChat).not.toHaveBeenCalled();
});

test("a refused preview says why and keeps the last one", async () => {
  const { fake, user } = mount(["Be direct."]);
  await screen.findByRole("list", { name: "Parts" });
  fake.raw.getChatPrompt.mockRejectedValue(rpcError(-32602, "line 1 is 400 characters; a line may have at most 300"));
  await user.type(await box(1), "x");
  expect((await screen.findByText(/line 1 is 400 characters/)).getAttribute("role")).toBe("alert");
  expect(screen.getByRole("list", { name: "Parts" })).toBeTruthy();
});

test("the note links to Memory", async () => {
  mount();
  const link = await screen.findByRole("link", { name: "Memory" });
  expect(link.getAttribute("href")).toBe("/settings/memory");
});

test("search finds instructions, response style and system prompt in Chat", () => {
  for (const query of ["instructions", "response style", "system prompt"]) {
    expect(searchSettings(query).map((match) => match.section.id)).toContain("chat");
  }
});

test("the page has no general or code wording in the section", async () => {
  mount();
  const section = (await screen.findByRole("heading", { name: "Your instructions" })).closest("section");
  expect(section?.textContent ?? "").not.toMatch(/\b(git|commits?|code|repos?)\b/i);
});

test("the page has no accessibility violations", async () => {
  const { container } = mount(["Be direct."]);
  await screen.findByRole("list", { name: "Parts" });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
