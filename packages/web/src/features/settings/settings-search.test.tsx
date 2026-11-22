import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { settingsContextStore } from "./index.ts";
import { SECTIONS } from "./sections.ts";
import { findSettingRow, searchSettings } from "./settings-search.ts";

function mount(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { user: userEvent.setup() };
}

const nav = () => screen.getByRole("navigation", { name: "Settings sections" });
const box = () => screen.getByRole("textbox", { name: "Search settings" });

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
});

test("every section has keywords", () => {
  for (const section of SECTIONS) expect(section.keywords.length, section.id).toBeGreaterThan(0);
});

test("a title is matched first, then the keywords, ignoring case", () => {
  expect(searchSettings("ROUT").map((hit) => [hit.section.id, hit.keyword])).toEqual([["routing", null]]);
  // "ollama" is a keyword of Info and Routing, and the title of neither.
  expect(searchSettings("ollama").map((hit) => [hit.section.id, hit.keyword])).toEqual([
    ["info", "ollama"],
    ["routing", "ollama"],
  ]);
  expect(searchSettings("   ")).toEqual([]);
});

test("a title match shows the section with the match marked and no second line", async () => {
  const { user } = mount("/settings");
  await user.type(box(), "rout");
  expect(within(nav()).getByText("1 result")).toBeTruthy();
  const link = within(nav()).getByRole("link", { name: "Routing" });
  expect(link.querySelector("mark")?.textContent).toBe("Rout");
  expect(within(nav()).queryByText("Models")).toBeNull();
});

test("a keyword match shows the keyword on a second line", async () => {
  const { user } = mount("/settings");
  await user.type(box(), "quiet");
  expect(within(nav()).getByText("1 result")).toBeTruthy();
  const link = within(nav()).getByRole("link", { name: /Notifications/ });
  expect(link.querySelector("mark")?.textContent).toBe("quiet");
  expect(link.textContent).toBe("Notificationsquiet hours");
});

test("a query with no match says so and links to the config file", async () => {
  const { user } = mount("/settings");
  await user.type(box(), "zzz");
  expect(within(nav()).getByText(/Nothing matches “zzz”/)).toBeTruthy();
  await user.click(within(nav()).getByRole("link", { name: "the config file" }));
  expect(location.pathname).toBe("/settings/config");
  expect((box() as HTMLInputElement).value).toBe("");
});

test("/ focuses the box, Esc clears it, and Enter opens the first result", async () => {
  const { user } = mount("/settings");
  expect(document.activeElement).not.toBe(box());
  await user.keyboard("/");
  expect(document.activeElement).toBe(box());
  // The slash is not typed into the box.
  expect((box() as HTMLInputElement).value).toBe("");
  await user.keyboard("ollama");
  expect(within(nav()).getAllByRole("link")).toHaveLength(2);
  await user.keyboard("{Escape}");
  expect((box() as HTMLInputElement).value).toBe("");
  expect(within(nav()).getByRole("link", { name: "Appearance" })).toBeTruthy();
  await user.keyboard("pro");
  await user.keyboard("{Enter}");
  // "pro" matches the keyword "provider" of API keys first.
  expect(location.pathname).toBe("/settings/keys");
  expect((box() as HTMLInputElement).value).toBe("");
});

test("a keyword result scrolls to its data-setting row and rings it, then the ring goes", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const { user } = mount("/settings");
  await user.type(box(), "thinking");
  await user.click(within(nav()).getByRole("link", { name: /Chat/ }));
  expect(location.pathname).toBe("/settings/chat");
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-setting="thinking"]');
    expect(found?.classList.contains("animate-flash")).toBe(true);
    return found as HTMLElement;
  });
  expect(scroll.mock.contexts).toContain(row);
  expect(row.classList.contains("motion-reduce:ring-clay")).toBe(true);
  await waitFor(() => expect(row.classList.contains("animate-flash")).toBe(false), { timeout: 3000 });
});

test("a keyword with no tagged row just opens the section", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const { user } = mount("/settings");
  await user.type(box(), "keychain");
  await user.click(within(nav()).getByRole("link", { name: /API keys/ }));
  expect(location.pathname).toBe("/settings/keys");
  expect(scroll).not.toHaveBeenCalled();
});

test("findSettingRow takes the exact tag before a tag that starts with the word", () => {
  document.body.innerHTML = '<p data-setting="data folder"></p><p id="exact" data-setting="data"></p>';
  expect(findSettingRow(document, "Data")?.id).toBe("exact");
  document.body.innerHTML = "";
});
