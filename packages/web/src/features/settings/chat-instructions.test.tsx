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

const openDraft = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "✦ Draft with golem" }));
const openReads = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "See all of it" }));
  return screen.getByRole("group", { name: "What the model reads" });
};
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

test("with no lines it says so, the count is 0, and no helper is open", async () => {
  mount();
  expect(await screen.findByText("No instructions. The model answers in its own style.")).toBeTruthy();
  expect(await screen.findByText(/0 lines · about 3 tokens in every chat/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "+ Write a line" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "✦ Draft with golem" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("heading", { name: "Draft with golem" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "From your chats" })).toBeNull();
  expect(screen.queryByText("Sent top to bottom")).toBeNull();
});

test("the count follows the lines", async () => {
  const { user } = mount(["One.", "Two."]);
  expect(await screen.findByText(/2 lines · about 3 tokens/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Remove line 2" }));
  expect(await screen.findByText(/1 line · about 3 tokens/)).toBeTruthy();
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
  await openDraft(user);
  expect(screen.getByRole("button", { name: "✦ Draft with golem" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("heading", { name: "Draft with golem" })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Describe how you like answers, in your words" }), "simple and friendly");
  await user.click(screen.getByRole("button", { name: "Draft lines" }));
  expect(fake.raw.draftChat).toHaveBeenCalledWith("simple and friendly");
  const drafted = await screen.findByRole("list", { name: "Drafted lines" });
  expect(within(drafted).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Keep it friendly.Add", "Use short words.Add"]);
  expect(screen.getByText("ollama/qwen3").closest("p")?.textContent).toBe("Drafted by ollama/qwen3, the model for titles and summaries. Change it in Routing.");
  expect(within(screen.getByText("ollama/qwen3").closest("p")!).getByRole("link", { name: "Routing" }).getAttribute("href")).toBe("/settings/routing");
  await user.click(within(drafted).getByRole("button", { name: "Add “Keep it friendly.”" }));
  await waitFor(() => expect(lastSet(fake)).toEqual({ instructions: ["Use metric units.", "Keep it friendly."] }));
  expect(within(screen.getByRole("list", { name: "Drafted lines" })).getAllByRole("listitem")).toHaveLength(1);
});

test("Add all adds the drafted lines that are not there yet", async () => {
  const { fake, user } = mount(["Use metric units."]);
  fake.raw.draftChat.mockResolvedValue({ lines: ["Use metric units.", "Keep it friendly.", "Use short words."], model: "m" });
  await box(1);
  await openDraft(user);
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
  await openDraft(user);
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

const openIdeas = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name }));
  return within(await screen.findByRole("list", { name: "From your chats" }));
};

test("the ideas button shows the count and opens the suggestions on a click", async () => {
  const { user } = mount(["Be direct."], SUGGESTED);
  const button = await screen.findByRole("button", { name: "2 ideas from your chats" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("heading", { name: "From your chats" })).toBeNull();
  await user.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("heading", { name: "From your chats" })).toBeTruthy();
  await user.click(button);
  expect(screen.queryByRole("heading", { name: "From your chats" })).toBeNull();
});

test("the draft panel and the ideas panel open on their own buttons", async () => {
  const { user } = mount([], SUGGESTED);
  await user.click(await screen.findByRole("button", { name: "2 ideas from your chats" }));
  expect(screen.getByRole("heading", { name: "From your chats" })).toBeTruthy();
  await openDraft(user);
  expect(screen.getByRole("heading", { name: "Draft with golem" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "From your chats" })).toBeNull();
});

test("From your chats shows each line with its reason, and Add saves it appended", async () => {
  const { fake, user } = mount(["Be direct."], SUGGESTED);
  const list = await openIdeas(user, "2 ideas from your chats");
  expect(list.getByText("You said “shorter” or “tl;dr” in 4 chats this week.")).toBeTruthy();
  expect(list.getByText("From memory: “Prefers bullet points.”")).toBeTruthy();
  await user.click(list.getByRole("button", { name: "Add “Keep answers short.”" }));
  await waitFor(() => {
    expect(lastSet(fake)).toEqual({ instructions: ["Be direct.", "Keep answers short."] });
  });
  expect(screen.queryByRole("button", { name: "Add “Keep answers short.”" })).toBeNull();
  expect(screen.getByRole("button", { name: "1 idea from your chats" })).toBeTruthy();
});

test("Not for me sends the dismiss and hides the line", async () => {
  const { fake, user } = mount([], SUGGESTED);
  await openIdeas(user, "2 ideas from your chats");
  await user.click(screen.getByRole("button", { name: "Not for me: “Prefer bullet points.”" }));
  expect(fake.raw.dismissChatSuggestion).toHaveBeenCalledWith("Prefer bullet points.");
  expect(screen.queryByText("Prefer bullet points.")).toBeNull();
  expect(screen.getByText("Keep answers short.")).toBeTruthy();
});

test("with no suggestions there is no ideas button", async () => {
  mount([], { suggestions: [], updated: null, needs_local_model: false });
  await screen.findByRole("button", { name: "✦ Draft with golem" });
  await screen.findByText(/0 lines/);
  expect(screen.queryByRole("button", { name: /from your chats/i })).toBeNull();
});

test("without a local model the plain From your chats button says it needs one", async () => {
  const { user } = mount([], { suggestions: [], updated: null, needs_local_model: true });
  await user.click(await screen.findByRole("button", { name: "From your chats" }));
  expect(await screen.findByText("Needs a local model, because it reads your messages.")).toBeTruthy();
});

test("the reads line shows the total and your share, and See all of it opens the parts", async () => {
  const { user } = mount(["Be direct."]);
  const reads = await screen.findByRole("group", { name: "What the model reads" });
  await within(reads).findByText("114");
  expect(reads.textContent).toContain("The model reads 114 tokens before your message: yours are 3.");
  expect(within(reads).queryByRole("list", { name: "Parts" })).toBeNull();
  await user.click(within(reads).getByRole("button", { name: "See all of it" }));
  const parts = within(reads).getByRole("list", { name: "Parts" });
  expect(within(parts).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Your instructions3", "Memory6", "Skills5", "Tools100"]);
  expect(reads.textContent).toContain("Total: 114 tokens. Before your message, on every call. Rebuilt each time, never stored.");
  expect(within(reads).getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
});

test("a part opens its text", async () => {
  const { user } = mount(["Be direct."]);
  const reads = await openReads(user);
  await user.click(within(reads).getByRole("button", { name: /Your instructions/ }));
  expect(within(reads).getByLabelText("Your instructions, as the model reads it").textContent).toBe("Be direct.");
  await user.click(within(reads).getByRole("button", { name: /Memory/ }));
  expect(within(reads).getByLabelText("Memory, as the model reads it").textContent).toBe("You like metric units.");
  expect(screen.getByText(/1 line · about 3 tokens in every chat/)).toBeTruthy();
  await user.click(within(reads).getByRole("button", { name: "Hide" }));
  expect(within(reads).queryByRole("list", { name: "Parts" })).toBeNull();
});

test("it asks again with the unsaved lines, and with the saved ones when they match again", async () => {
  const { fake, user } = mount(["Be direct."]);
  await screen.findByText(/tokens before your message/);
  await waitFor(() => expect(fake.raw.getChatPrompt).toHaveBeenCalledWith({}));
  await user.type(await box(1), " Fast.");
  await waitFor(() => expect(fake.raw.getChatPrompt).toHaveBeenCalledWith({ instructions: ["Be direct. Fast."] }));
  expect(fake.raw.setChat).not.toHaveBeenCalled();
});

test("a refused preview says why and keeps the last one", async () => {
  const { fake, user } = mount(["Be direct."]);
  await screen.findByText(/tokens before your message/);
  fake.raw.getChatPrompt.mockRejectedValue(rpcError(-32602, "line 1 is 400 characters; a line may have at most 300"));
  await user.type(await box(1), "x");
  expect((await screen.findByText(/line 1 is 400 characters/)).getAttribute("role")).toBe("alert");
  expect(screen.getByText(/tokens before your message/)).toBeTruthy();
});

test("the first read failing shows the error", async () => {
  const { fake } = mount();
  fake.raw.getChatPrompt.mockRejectedValue(rpcError(-32603, "the model is not set up"));
  expect((await screen.findByText(/the model is not set up/)).getAttribute("role")).toBe("alert");
});

test("the note links to Memory", async () => {
  const { user } = mount();
  await openReads(user);
  const link = within(screen.getByRole("group", { name: "What the model reads" })).getByRole("link", { name: "Memory" });
  expect(link.getAttribute("href")).toBe("/settings/memory");
});

test("search finds instructions, response style and system prompt in Chat", () => {
  for (const query of ["instructions", "response style", "system prompt"]) {
    expect(searchSettings(query).map((match) => match.section.id)).toContain("chat");
  }
});

test("the page has no general or code wording in the section", async () => {
  const { user } = mount();
  await openReads(user);
  const section = screen.getByRole("group", { name: "What the model reads" }).closest("[data-setting]");
  expect(section?.textContent ?? "").not.toMatch(/\b(git|commits?|code|repos?)\b/i);
});

test("the page has no accessibility violations", async () => {
  const { container, user } = mount(["Be direct."], SUGGESTED);
  await openReads(user);
  await openDraft(user);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(screen.getByRole("button", { name: "2 ideas from your chats" }));
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
