import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

/** The list row of an agent: a button whose name starts with the agent's name. */
function rowOf(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
}

/** Chooses an agent in the list, and waits for its detail. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string): Promise<HTMLElement> {
  await user.click(rowOf(name));
  return screen.getByRole("heading", { name, level: 3 });
}

/** The file text on the page. */
const fileOf = (name: string): HTMLElement => screen.getByLabelText(`File of ${name}`);

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
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

test("the list shows each agent with its mark, its wish and the model it becomes, and the first is open", async () => {
  mount();
  await screen.findByText("7 agents");
  expect(rowOf("explorer").textContent).toBe("explorer bundled cheapest → qwen3:14b");
  expect(rowOf("reviewer").textContent).toBe("reviewer bundled stronger than the lead → claude-sonnet");
  expect(rowOf("triage").textContent).toBe("triage yours cheapest");
  expect(rowOf("docs").textContent).toBe("docs project same as the lead");
  expect(rowOf("worker").textContent).toContain("not yet");
  expect(rowOf("explorer").textContent).not.toContain("not yet");
  expect(rowOf("docs").getAttribute("aria-current")).toBe("true");
  expect(rowOf("explorer").getAttribute("aria-current")).toBeNull();
  expect(screen.getByRole("heading", { name: "docs", level: 3 })).toBeTruthy();
});

test("a project agent of a folder that is not trusted is not a row, and a line says to trust the folder", async () => {
  mount();
  await screen.findByText("7 agents");
  expect(screen.queryByRole("button", { name: /^release/ })).toBeNull();
  expect(screen.getByText("Trust this folder to use its agent release.")).toBeTruthy();
});

test("a broken agent file shows its error under the head", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await choose(user, "broken-one");
  expect(screen.getByRole("note").textContent).toContain("the frontmatter is not valid YAML");
  expect(screen.queryByRole("button", { name: /^Model wish of broken-one/ })).toBeNull();
});

test("with no agents the page says how to add one", async () => {
  mount([]);
  expect(await screen.findByText("0 agents")).toBeTruthy();
  expect(screen.getByText(/Add one as ~\/\.golem\/agents/)).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
});

test("the Overview of a bundled agent says its model, tools, limits, prompt and use", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await choose(user, "explorer");
  const model = screen.getByRole("region", { name: "Model" });
  expect(model.textContent).toContain("now qwen3:14b");
  expect(model.textContent).toContain("the cheapest model that fits, a local one first");
  expect(within(model).getByRole("button", { name: /^Model wish of explorer: Cheapest that fits/ })).toBeTruthy();
  const tools = within(screen.getByRole("region", { name: "Can use" })).getAllByRole("listitem");
  expect(tools.map((item) => item.textContent)).toEqual(["read_file", "list_dir", "glob", "grep", "git_log", "git_diff", "git_status"]);
  expect(screen.getByText("All of these only read.")).toBeTruthy();
  const limits = screen.getByRole("region", { name: "Limits" });
  expect(limits.textContent).toContain("15tool calls");
  expect(limits.textContent).toContain("5 mintime");
  expect(limits.textContent).toContain("6000answer chars");
  expect(limits.textContent).toContain("Never asks you; it works from the brief.");
  expect(screen.getByRole("region", { name: "Prompt" }).textContent).toContain("You are a helper. Answer the brief.");
  expect(screen.getByText("41 runs in 30 days")).toBeTruthy();
});

test("an agent that cannot run says not yet and why, marks its changing tools, and may ask", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await choose(user, "worker");
  const note = screen.getByRole("note");
  expect(note.textContent).toBe("worker has tools that change things. Helpers that write come with a later step.");
  expect(screen.getAllByText("not yet").length).toBe(2);
  const chips = within(screen.getByRole("region", { name: "Can use" })).getAllByRole("listitem");
  expect(chips.map((chip) => chip.textContent)).toEqual(["read_file", "! edit_file (changes things)", "! shell (changes things)"]);
  expect(screen.getByText("Marked tools change things.")).toBeTruthy();
  expect(screen.getByText("May ask you one short question.")).toBeTruthy();
  expect(screen.getByText("Cannot run yet")).toBeTruthy();
});

test("an agent with no tools says it works from the brief alone", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await choose(user, "advisor");
  expect(screen.getByText("None. It works from the brief alone.")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Limits" }).textContent).toContain("1tool calls");
});

test("Definition shows the path, read-only for a bundled file, and the file with its keys tinted", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  await choose(user, "reviewer");
  await user.click(screen.getByRole("tab", { name: "Definition" }));
  expect(screen.getByText("golem/agents/bundled/reviewer.md · read-only")).toBeTruthy();
  const file = fileOf("reviewer");
  expect(file.textContent).toContain("name: reviewer");
  expect(file.textContent).toContain("You are a reviewer. Say what is wrong, most serious first.");
  expect(within(file).getByText("name:").className).toContain("text-clay-ink");
  // The prompt is never tinted, even when a line looks like a key.
  expect(within(file).queryByText("You are a reviewer.", { exact: false })?.className ?? "").not.toContain("text-clay-ink");
  await choose(user, "triage");
  await user.click(screen.getByRole("tab", { name: "Definition" }));
  expect(screen.getByText("~/.golem/agents/triage.md")).toBeTruthy();
  expect(screen.queryByText(/read-only/)).toBeNull();
});

test("Copy text puts the whole file on the clipboard", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await choose(user, "explorer");
  await user.click(screen.getByRole("tab", { name: "Definition" }));
  await user.click(screen.getByRole("button", { name: "Copy text" }));
  expect(writeText).toHaveBeenCalledWith(SAMPLE_AGENTS.find((agent) => agent.name === "explorer")?.text);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("the tabs are real tabs: the arrow keys move between them", async () => {
  const { user } = mount();
  await screen.findByText("7 agents");
  const overview = screen.getByRole("tab", { name: "Overview" });
  expect(overview.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(overview.id);
  overview.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Definition" }).getAttribute("aria-selected")).toBe("true");
  expect(fileOf("docs")).toBeTruthy();
});

test("an older daemon that sends no file says so in the Definition", async () => {
  const { user } = mount(WISH_AGENTS_MIXED);
  await screen.findByText("5 agents");
  await user.click(screen.getByRole("tab", { name: "Definition" }));
  expect(screen.getByText(/The daemon did not send this file/)).toBeTruthy();
});

test("a narrow window is one column whose rows open in place, one at a time", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  const { user } = mount();
  await screen.findByText("7 agents");
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  const explorer = rowOf("explorer");
  expect(explorer.getAttribute("aria-expanded")).toBe("false");
  await user.click(explorer);
  expect(rowOf("explorer").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("group", { name: "explorer details" }).textContent).toContain("You are a helper.");
  expect(screen.getByRole("tab", { name: "Definition" })).toBeTruthy();
  await user.click(rowOf("reviewer"));
  expect(rowOf("explorer").getAttribute("aria-expanded")).toBe("false");
  expect(screen.getAllByRole("group").filter((group) => !group.matches("fieldset"))).toHaveLength(1);
  await user.click(rowOf("reviewer"));
  expect(screen.queryByRole("group", { name: /^(?!Use helpers)/ })).toBeNull();
});

test("the settings search finds the page's fields", async () => {
  mount();
  await screen.findByText("7 agents");
  for (const field of ["helpers", "model", "can use", "limits", "prompt"]) {
    expect(document.querySelector(`[data-setting="${field}"]`), field).not.toBeNull();
  }
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
  expect(rowOf("explorer").textContent).toContain("cheapest → qwen3:14b");
  expect(screen.getByRole("heading", { name: "explorer", level: 3 })).toBeTruthy();
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
  await waitFor(() => expect(screen.getByRole("region", { name: "Model" }).textContent).toContain("now claude-haiku"), { timeout: 4000 });
  expect(rowOf("reviewer").textContent).toContain("→ claude-opus");
  await openFirst(user);
  expect(screen.queryByRole("menuitemradio", { name: /Always local/ })).toBeNull();
  expect(screen.getByRole("menuitemradio", { name: /Always frontier/ })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(LOCAL_WORDS);
});

test("local models only: now says the local model, and no hosted word shows, even in the menu", async () => {
  const { user } = mount(WISH_AGENTS_LOCAL, listing(["local", "local"]));
  await screen.findByText("5 agents");
  await waitFor(() => expect(screen.getByRole("region", { name: "Model" }).textContent).toContain("now qwen3:8b"));
  await choose(user, "reviewer");
  expect(screen.getByRole("region", { name: "Model" }).textContent).toContain("now qwen3:14b, fresh window");
  await choose(user, "explorer");
  await openFirst(user);
  expect(screen.queryByRole("menuitemradio", { name: /Always budget/ })).toBeNull();
  expect(screen.queryByRole("menuitemradio", { name: /Always frontier/ })).toBeNull();
  expect(screen.getByRole("menuitemradio", { name: /Always local/ })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(HOSTED_WORDS);
});

test("mixed: every wish is offered, and now says local or hosted per type", async () => {
  const { user } = mount(WISH_AGENTS_MIXED, listing(["local", "budget"]));
  await screen.findByText("5 agents");
  await waitFor(() => expect(screen.getByRole("region", { name: "Model" }).textContent).toContain("now qwen3:14b"));
  expect(rowOf("triage").textContent).toContain("always local → qwen3:14b");
  expect(rowOf("reviewer").textContent).toContain("stronger than the lead → claude-sonnet");
  expect(rowOf("worker").textContent).toContain("same as the lead → claude-sonnet");
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
  await waitFor(() => expect(screen.getByRole("region", { name: "Model" }).textContent).toContain("now claude-opus"));
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
  const { user } = mount(WISH_AGENTS_MIXED.map((agent) => (agent.name === "worker" ? { ...agent, resolves_to: undefined } : agent)), listing(["local", "budget"]));
  await screen.findByText("5 agents");
  await choose(user, "broken-one");
  expect(screen.queryByRole("button", { name: /^Model wish of broken-one/ })).toBeNull();
  await choose(user, "worker");
  expect(screen.getByRole("button", { name: /^Model wish of worker/ })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Model" }).textContent).not.toContain("now ");
  expect(rowOf("worker").textContent).toBe("worker bundled same as the lead");
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
