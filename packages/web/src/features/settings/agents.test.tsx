import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS } from "./agents-sample.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const FOLDER = "/Users/you/repos/golem";
const METHOD_NOT_FOUND = -32601;

function mount(agents = SAMPLE_AGENTS) {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents });
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
