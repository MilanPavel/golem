import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import type { ModelListResult } from "../../store/models.ts";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS, WISH_AGENTS_CLOUD, WISH_AGENTS_LOCAL, WISH_AGENTS_MIXED } from "./agents-sample.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const FOLDER = "/Users/you/repos/golem";
const METHOD_NOT_FOUND = -32601;

function listing(tiers: ("local" | "budget" | "frontier")[]): ModelListResult {
  return {
    default: `${tiers[0] === "local" ? "ollama" : "anthropic"}/m0`,
    providers: [],
    setup: { ollama_installed: true, ollama_running: true },
    models: tiers.map((tier, at) => ({
      ref: `${tier === "local" ? "ollama" : "anthropic"}/m${at}`,
      label: `M${at}`,
      provider: tier === "local" ? "ollama" : "anthropic",
      source: "installed",
      status: "ready",
      price: { input: 0, output: 0 },
      tier,
    })),
  } as ModelListResult;
}

function mount(agents = SAMPLE_AGENTS, models?: ModelListResult) {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents });
  if (models !== undefined) fake.raw.listModels.mockResolvedValue(models);
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
  return { fake, page, user: userEvent.setup(), ...view };
}

/** The cells of the row of an agent, by column. */
function cells(name: string): string[] {
  const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByRole("rowheader", { name: new RegExp(`^${name}\\b`) }) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("while the daemon has not answered the page says it is asking", async () => {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockReturnValue(new Promise(() => {}));
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect(await screen.findByText("asking the daemon…")).toBeTruthy();
});

test("the table shows bundled, user and project agents with wish, used and finished", async () => {
  mount();
  await screen.findByText("7 agents");
  expect(cells("explorer")).toEqual(["Cheapest that fits", "41", "39"]);
  expect(cells("reviewer")).toEqual(["Stronger than the lead", "20", "19"]);
  expect(cells("advisor")).toEqual(["Stronger than the lead", "4", "—"]);
  expect(cells("worker")).toEqual(["Cheapest that fits", "—", "—"]);
  expect(cells("triage")).toEqual(["Cheapest that fits", "12", "10"]);
  expect(cells("docs")).toEqual(["Same as the lead", "3", "3"]);
  const sources = screen.getAllByRole("rowheader").map((header) => header.textContent);
  expect(sources.find((text) => text?.startsWith("docs"))).toContain("This project");
  expect(sources.find((text) => text?.startsWith("triage"))).toContain("Yours");
  expect(sources.find((text) => text?.startsWith("explorer"))).toContain("Bundled with golem");
  expect(screen.getByRole("columnheader", { name: "Finished" })).toBeTruthy();
});

test("a project agent of a folder that is not trusted is not a row, and a line says to trust the folder", async () => {
  mount();
  await screen.findByText("7 agents");
  expect(screen.queryByRole("rowheader", { name: /^release/ })).toBeNull();
  expect(screen.getByText("Trust this folder to use its agent release.")).toBeTruthy();
});

test("a broken agent file shows its error", async () => {
  mount();
  await screen.findByText("7 agents");
  const header = screen.getByRole("rowheader", { name: /^broken-one/ });
  expect(within(header).getByRole("note").textContent).toContain("the frontmatter is not valid YAML");
});

test("with no agents the page says how to add one", async () => {
  mount([]);
  expect(await screen.findByText("0 agents")).toBeTruthy();
  expect(screen.getByText(/Add one as ~\/\.golem\/agents/)).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

test("only blocked project agents leave an empty table and the trust line", async () => {
  mount([{ name: "docs", description: "", origin: "project", wish: "same", trusted: false }]);
  expect(await screen.findByText("0 agents")).toBeTruthy();
  expect(screen.getByText("Trust this folder to use its agent docs.")).toBeTruthy();
});

test("the daemon is asked for the folder's agents", async () => {
  const { fake } = mount();
  await screen.findByText("7 agents");
  expect(fake.raw.listAgents).toHaveBeenCalledWith(FOLDER);
});

test("an agent.registry.changed event reads the list again", async () => {
  const { fake } = mount();
  await screen.findByText("7 agents");
  fake.raw.listAgents.mockResolvedValue({ agents: [SAMPLE_AGENTS[4]!] });
  act(() => {
    fake.emitAgents(null);
  });
  expect(await screen.findByText("1 agent")).toBeTruthy();
  expect(cells("explorer")).toEqual(["Cheapest that fits", "41", "39"]);
});

test("a daemon that does not know agents.list gets a plain not available state, and no retry button", async () => {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockRejectedValue(rpcError(METHOD_NOT_FOUND, "method not found"));
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect(await screen.findByText(/Agents are not available/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fake.raw.listAgents).toHaveBeenCalledTimes(1);
  // The other sections still open.
  expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
});

test("another failure shows the reason and a Retry that asks again", async () => {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockRejectedValue(new Error("the daemon is busy"));
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  const user = userEvent.setup();
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("the daemon is busy");
  fake.raw.listAgents.mockResolvedValue({ agents: [] });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByText("0 agents")).toBeTruthy());
});

test("the page has no word about local models, with cloud-only or local-only agents alike", async () => {
  mount();
  await screen.findByText("7 agents");
  expect(document.body.textContent?.toLowerCase()).not.toContain("local model");
});

test("axe is clean in both themes", async () => {
  const { container } = mount();
  await screen.findByText("7 agents");
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  }
});

const LOCAL_WORDS = /local|computer|ollama|qwen/i;
const HOSTED_WORDS = /paid|hosted|budget|frontier|claude|cloud/i;

/** The page's text with the dropdown of the first type open. */
async function openFirst(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Model wish of explorer/ }));
  await screen.findByRole("menuitemradio", { name: /Same as the lead/ });
}

test("cloud models only: now says the hosted model, and no word of local models shows, even in the menu", async () => {
  const { user } = mount(WISH_AGENTS_CLOUD, listing(["budget", "frontier"]));
  await screen.findByText("5 agents");
  await screen.findAllByText("now: claude-haiku", {}, { timeout: 4000 });
  await openFirst(user);
  expect(screen.queryByRole("menuitemradio", { name: /Always local/ })).toBeNull();
  expect(screen.getByRole("menuitemradio", { name: /Always frontier/ })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(LOCAL_WORDS);
});

test("local models only: now says the local model, and no hosted word shows, even in the menu", async () => {
  const { user } = mount(WISH_AGENTS_LOCAL, listing(["local", "local"]));
  await screen.findByText("5 agents");
  await screen.findAllByText("now: qwen3:8b");
  expect(screen.getByText(/now: qwen3:14b, fresh window/)).toBeTruthy();
  await openFirst(user);
  expect(screen.queryByRole("menuitemradio", { name: /Always budget/ })).toBeNull();
  expect(screen.queryByRole("menuitemradio", { name: /Always frontier/ })).toBeNull();
  expect(screen.getByRole("menuitemradio", { name: /Always local/ })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(HOSTED_WORDS);
});

test("mixed: every wish is offered, and now says local or hosted per type", async () => {
  const { user } = mount(WISH_AGENTS_MIXED, listing(["local", "budget"]));
  await screen.findByText("5 agents");
  expect(await screen.findAllByText("now: qwen3:14b")).toHaveLength(2);
  expect(screen.getAllByText("now: claude-sonnet")).toHaveLength(2);
  await openFirst(user);
  // The six wishes, then the two ready models of the listing, each a choice by name.
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(8);
  expect(screen.getAllByText("this model, always")).toHaveLength(2);
});

test("changing a wish calls agents.set_wish with the folder and shows what the result says", async () => {
  const { fake, user } = mount(WISH_AGENTS_MIXED, listing(["local", "budget"]));
  await screen.findByText("5 agents");
  fake.raw.setAgentWish.mockResolvedValue({ ...WISH_AGENTS_MIXED[0]!, wish: "stronger", resolves_to: { model: "claude-opus", reason: "one step above the lead" } });
  await openFirst(user);
  await user.click(screen.getByRole("menuitemradio", { name: /Stronger than the lead/ }));
  await waitFor(() => expect(fake.raw.setAgentWish).toHaveBeenCalledWith("explorer", "stronger", FOLDER));
  expect(await screen.findByText("now: claude-opus")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Model wish of explorer: Stronger than the lead/ })).toBeTruthy();
});

test("a refused change shows a plain line and the old value stays", async () => {
  const { fake, user } = mount(WISH_AGENTS_MIXED, listing(["local", "budget"]));
  await screen.findByText("5 agents");
  fake.raw.setAgentWish.mockRejectedValue(new Error("this agent file is read-only"));
  await openFirst(user);
  await user.click(screen.getByRole("menuitemradio", { name: /Stronger than the lead/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("this agent file is read-only");
  expect(screen.getByRole("button", { name: /^Model wish of explorer: Cheapest that fits/ })).toBeTruthy();
});

test("a daemon that does not answer agents.set_wish gets a plain line, and the old value stays", async () => {
  const { fake, user } = mount(WISH_AGENTS_MIXED, listing(["local", "budget"]));
  await screen.findByText("5 agents");
  fake.raw.setAgentWish.mockRejectedValue(rpcError(METHOD_NOT_FOUND, "method not found"));
  await openFirst(user);
  await user.click(screen.getByRole("menuitemradio", { name: /Always frontier/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("This golem is too old to change a wish. Update golem.");
  expect(screen.getByRole("button", { name: /^Model wish of explorer: Cheapest that fits/ })).toBeTruthy();
});

test("a broken agent has no dropdown, and an older daemon's type shows the wish without now", async () => {
  mount(WISH_AGENTS_MIXED.map((agent) => (agent.name === "worker" ? { ...agent, resolves_to: undefined } : agent)), listing(["local", "budget"]));
  await screen.findByText("5 agents");
  expect(screen.queryByRole("button", { name: /^Model wish of broken-one/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Model wish of worker/ })).toBeTruthy();
  expect(screen.getAllByText(/^now: /)).toHaveLength(3);
});

test("axe is clean for the three setups with the menu open", async () => {
  for (const [agents, tiers] of [
    [WISH_AGENTS_LOCAL, ["local"]],
    [WISH_AGENTS_MIXED, ["local", "budget"]],
    [WISH_AGENTS_CLOUD, ["frontier"]],
  ] as const) {
    const { user, container, unmount } = mount(agents, listing([...tiers]));
    await screen.findByText("5 agents");
    await openFirst(user);
    // The open menu is outside the page's landmarks, so the region rule is left out for the whole body.
    expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
});
