import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS } from "./agents-sample.ts";
import { agentsTabOf, showAgentsTab } from "./agents-tab.ts";
import { settingsContextStore } from "./index.ts";
import { searchSettings } from "./settings-search.ts";

const FOLDER = "/Users/you/repos/golem";
const noContrast = { rules: { "color-contrast": { enabled: false } } };

function mount(path = "/settings/agents") {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30, use_helpers: "ask" } });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", FOLDER));
  });
  settingsContextStore.set({ sessionId: "a", cwd: FOLDER });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { user: userEvent.setup(), ...view };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const nav = () => screen.getByRole("navigation", { name: "Settings sections" });

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
  showAgentsTab("agents");
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  showAgentsTab("agents");
});

test("the page opens on Agents, with three tabs in a tab list", async () => {
  mount();
  await screen.findByText("7 agents");
  const list = screen.getByRole("tablist", { name: "Parts of Agents" });
  expect(within(list).getAllByRole("tab").map((each) => each.textContent)).toEqual(["Agents", "Rules", "Measure"]);
  expect(tab("Agents").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", { name: "Agents" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Finished helpers" })).toBeNull();
});

test("Rules is three blocks, one after the other, each with its own heading", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await user.click(tab("Rules"));
  const panel = screen.getByRole("tabpanel", { name: "Rules" });
  await within(panel).findByRole("region", { name: "Finished helpers" });
  expect(within(panel).getAllByRole("heading", { level: 3 }).map((each) => each.textContent)).toEqual(["Use helpers", "Limits for every helper", "Finished helpers"]);
  expect(within(panel).getByRole("region", { name: "Limits for every helper" }).textContent).not.toContain("Keep the steps for");
  expect((await axe.run(panel, noContrast)).violations).toEqual([]);
});

test("Measure says it comes later", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await user.click(tab("Measure"));
  expect(screen.getByRole("tabpanel", { name: "Measure" }).textContent).toBe("Measuring helpers on this Mac comes in a later version.");
});

test("arrow keys move between the tabs, and the tab stays when the page is left and opened again", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  tab("Agents").focus();
  await user.keyboard("{ArrowRight}");
  expect(tab("Rules").getAttribute("aria-selected")).toBe("true");
  await user.click(within(nav()).getByRole("link", { name: "Skills" }));
  await user.click(within(nav()).getByRole("link", { name: "Agents" }));
  expect(tab("Rules").getAttribute("aria-selected")).toBe("true");
});

test("which tab a search keyword of Agents lands on", () => {
  for (const [word, want] of [["use helpers", "rules"], ["finished", "rules"], ["limits", "rules"], ["prompt", "agents"], ["explorer", "agents"], ["helpers", "agents"]] as const) {
    const hit = searchSettings(word).find((each) => each.section.id === "agents");
    expect(hit?.keyword, word).not.toBeNull();
    expect(agentsTabOf(hit?.keyword ?? ""), word).toBe(want);
  }
});

test("a search result for Finished helpers opens Rules and scrolls to the block", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const { user } = mount("/settings");
  await user.type(screen.getByRole("textbox", { name: "Search settings" }), "finished");
  await user.click(within(nav()).getByRole("link", { name: /Agents/ }));
  expect(location.pathname).toBe("/settings/agents");
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-setting="finished helpers"]');
    expect(found?.classList.contains("animate-flash")).toBe(true);
    return found as HTMLElement;
  });
  expect(scroll.mock.contexts).toContain(row);
  expect(tab("Rules").getAttribute("aria-selected")).toBe("true");
});

test("a search result for an agent field opens Agents even when Rules was open", async () => {
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  showAgentsTab("rules");
  const { user } = mount("/settings");
  await user.type(screen.getByRole("textbox", { name: "Search settings" }), "explorer");
  await user.click(within(nav()).getByRole("link", { name: /Agents/ }));
  await screen.findByText("7 agents");
  expect(tab("Agents").getAttribute("aria-selected")).toBe("true");
});
