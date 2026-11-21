import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import type { AgentInfo } from "../../store/agents.ts";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS, SAMPLE_COPY } from "./agents-sample.ts";
import { AgentsPage } from "./agents-section.tsx";
import { settingsContextStore } from "./index.ts";

const FOLDER = "/Users/you/repos/golem";
const NO_REGION = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

type User = ReturnType<typeof userEvent.setup>;

function mount(agents: AgentInfo[] = SAMPLE_AGENTS) {
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
  return { fake, user: userEvent.setup(), ...view };
}

const rowOf = (name: string): HTMLElement => screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
const sample = (name: string): AgentInfo => SAMPLE_AGENTS.find((agent) => agent.name === name)!;

/** Chooses an agent and opens its Definition tab. */
async function definitionOf(user: User, name: string): Promise<void> {
  await user.click(rowOf(name));
  await user.click(screen.getByRole("tab", { name: "Definition" }));
}

async function ready(): Promise<void> {
  await screen.findByText("7 agents");
}

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
});

test("Make my own copy copies the bundled agent; the copy is yours and says it replaces the bundled one", async () => {
  const { fake, user } = mount();
  await ready();
  const copy: AgentInfo = { ...sample("explorer"), origin: "user", shadowed: ["bundled"], path: "~/.golem/agents/explorer.md" };
  fake.raw.copyAgent.mockResolvedValue(copy);
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS.map((agent) => (agent.name === "explorer" ? copy : agent)) });
  await definitionOf(user, "explorer");
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Make my own copy" }));
  await waitFor(() => expect(fake.raw.copyAgent).toHaveBeenCalledWith("explorer", FOLDER));
  const edit = await screen.findByRole("button", { name: "Edit" });
  expect(screen.getByText("replaces the bundled explorer")).toBeTruthy();
  expect(rowOf("explorer").textContent).toContain("yours");
  expect(document.activeElement).toBe(edit);
});

test("a copy the daemon refuses is a line in place", async () => {
  const { fake, user } = mount();
  await ready();
  fake.raw.copyAgent.mockRejectedValue(rpcError(-32602, "you already have an agent named explorer"));
  await definitionOf(user, "explorer");
  await user.click(screen.getByRole("button", { name: "Make my own copy" }));
  expect((await screen.findByRole("alert")).textContent).toBe("you already have an agent named explorer");
});

test("Edit puts the file in a text box with the focus, and Cancel puts the focus back on Edit", async () => {
  const { user } = mount();
  await ready();
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Edit the file of triage" });
  expect(document.activeElement).toBe(box);
  expect((box as HTMLTextAreaElement).value).toContain("name: triage");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: /file of/i })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
});

test("a refused save keeps the text and says Not saved with the line and the problem", async () => {
  const { fake, user } = mount();
  await ready();
  fake.raw.saveAgent.mockResolvedValue({ ok: false, problems: [{ message: 'there is no tool named "read_files"', line: 5 }, { message: "the prompt is empty" }] });
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByRole("textbox", { name: "Edit the file of triage" }), "!");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.saveAgent).toHaveBeenCalledWith(expect.stringContaining("name: triage"), "triage", FOLDER));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe('Not saved.Line 5: there is no tool named "read_files"the prompt is empty');
  expect((screen.getByRole("textbox", { name: "Edit the file of triage" }) as HTMLTextAreaElement).value.endsWith("!")).toBe(true);
  expect((await axe.run(document.body, NO_REGION)).violations).toEqual([]);
});

test("a save that fails to reach the daemon says why and keeps the text", async () => {
  const { fake, user } = mount();
  await ready();
  fake.raw.saveAgent.mockRejectedValue(new Error("the daemon is busy"));
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Not saved.the daemon is busy");
});

test("a saved agent leaves the editor, the list is read again and the saved agent is chosen, even renamed", async () => {
  const { fake, user } = mount();
  await ready();
  const renamed: AgentInfo = { ...sample("triage"), name: "sorter" };
  fake.raw.saveAgent.mockResolvedValue({ ok: true, problems: [], agent: renamed });
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS.map((agent) => (agent.name === "triage" ? renamed : agent)) });
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { name: "sorter", level: 3 })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: /file of/i })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" })));
});

test("+ New agent opens the template, shows a row that is not saved yet, and Save picks the new agent", async () => {
  const { fake, user } = mount();
  await ready();
  const made: AgentInfo = { name: "my-agent", description: "What it does.", origin: "user", wish: "cheapest", path: "~/.golem/agents/my-agent.md", text: "---\nname: my-agent\n---\nx\n" };
  fake.raw.saveAgent.mockResolvedValue({ ok: true, problems: [], agent: made });
  fake.raw.listAgents.mockResolvedValue({ agents: [...SAMPLE_AGENTS, made] });
  await user.click(screen.getByRole("button", { name: "New agent" }));
  const box = screen.getByRole("textbox", { name: "File of the new agent" }) as HTMLTextAreaElement;
  expect(document.activeElement).toBe(box);
  expect(box.value).toContain("name: my-agent");
  expect(box.value).toContain("model: cheapest");
  expect(screen.getByText("not saved yet")).toBeTruthy();
  const text = box.value;
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.saveAgent).toHaveBeenCalledWith(text, undefined, FOLDER));
  expect(await screen.findByRole("heading", { name: "my-agent", level: 3 })).toBeTruthy();
  expect(screen.queryByText("not saved yet")).toBeNull();
});

test("Cancel of a new agent drops the row and the focus goes back to + New agent", async () => {
  const { user } = mount();
  await ready();
  await user.click(screen.getByRole("button", { name: "New agent" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("not saved yet")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "New agent" }));
});

test("Delete asks once in place, Keep backs out, and then it deletes and chooses what the name is now", async () => {
  const { fake, user } = mount();
  await ready();
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete this agent?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Keep" }));
  expect(screen.queryByText("Delete this agent?")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
  fake.raw.deleteAgent.mockResolvedValue({ agent: null });
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS.filter((agent) => agent.name !== "triage") });
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(fake.raw.deleteAgent).toHaveBeenCalledWith("triage", FOLDER));
  await screen.findByText("6 agents");
  expect(screen.queryByRole("button", { name: /^triage/ })).toBeNull();
  expect(rowOf("docs").getAttribute("aria-current")).toBe("true");
  expect(document.activeElement).toBe(rowOf("docs"));
});

test("deleting a copy says the bundled one comes back, and then the bundled agent is chosen", async () => {
  const withCopy = [...SAMPLE_AGENTS.filter((agent) => agent.name !== "reviewer"), SAMPLE_COPY];
  const { fake, user } = mount(withCopy);
  await ready();
  await definitionOf(user, "reviewer");
  expect(screen.getByText("replaces the bundled reviewer")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete your copy and go back to the bundled one?")).toBeTruthy();
  fake.raw.deleteAgent.mockResolvedValue({ agent: sample("reviewer") });
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS });
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(rowOf("reviewer").textContent).toContain("bundled"));
  expect(rowOf("reviewer").getAttribute("aria-current")).toBe("true");
  expect(screen.queryByText(/replaces the bundled/)).toBeNull();
});

test("a delete the daemon refuses is a line in place", async () => {
  const { fake, user } = mount();
  await ready();
  fake.raw.deleteAgent.mockRejectedValue(rpcError(-32602, "there is no agent file of your own named triage"));
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect((await screen.findByRole("alert")).textContent).toBe("there is no agent file of your own named triage");
});

test("leaving the editor with unsaved text asks first; Keep editing keeps the text and Discard drops it", async () => {
  const { user } = mount();
  await ready();
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByRole("textbox", { name: "Edit the file of triage" }), "x");
  await user.click(rowOf("explorer"));
  expect(screen.getByText("Discard changes?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByText("Discard changes?")).toBeNull();
  const box = screen.getByRole("textbox", { name: "Edit the file of triage" }) as HTMLTextAreaElement;
  expect(box.value.endsWith("x")).toBe(true);
  expect(document.activeElement).toBe(box);
  await user.click(screen.getByRole("tab", { name: "Overview" }));
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("textbox", { name: /file of/i })).toBeNull();
  expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
});

test("unchanged text is dropped without asking", async () => {
  const { user } = mount();
  await ready();
  await definitionOf(user, "triage");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(rowOf("explorer"));
  expect(screen.queryByText("Discard changes?")).toBeNull();
  expect(screen.queryByRole("textbox", { name: /file of/i })).toBeNull();
});

test("a project agent offers no Edit or Delete; your own agent's model goes through set_wish", async () => {
  const { fake, user } = mount();
  await ready();
  await definitionOf(user, "docs");
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  await user.click(rowOf("triage"));
  expect(screen.getByText("Saved in the agent's file, on its model line.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Model wish of triage/ }));
  await user.click(screen.getByRole("menuitemradio", { name: /Always local/ }));
  await waitFor(() => expect(fake.raw.setAgentWish).toHaveBeenCalledWith("triage", "local", FOLDER));
});

test("in the narrow layout the actions are inside the opened row", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => ({ ok: false, problems: [{ message: "the name is missing", line: 2 }] }));
  render(<AgentsPage agents={SAMPLE_AGENTS} narrow start="user/triage" onSave={onSave} onCopy={async (name) => ({ ...sample(name), origin: "user" })} onDelete={async () => ({ agent: null })} />);
  await user.click(screen.getByRole("tab", { name: "Definition" }));
  const group = screen.getByRole("group", { name: "triage details" });
  expect(group.contains(screen.getByRole("button", { name: "Edit" }))).toBe(true);
  expect(group.contains(screen.getByRole("button", { name: "Delete" }))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Not saved.Line 2: the name is missing");
  expect(group.contains(screen.getByRole("textbox"))).toBe(true);
  await user.click(screen.getByRole("button", { name: "New agent" }));
  expect(screen.getByRole("group", { name: "New agent details" })).toBeTruthy();
});

test("the gallery's editing states are axe-clean", async () => {
  for (const demo of ["edit", "refused", "delete", "new"] as const) {
    const { container, unmount } = render(<AgentsPage agents={SAMPLE_AGENTS} start="user/triage" demo={demo} onSave={async () => ({ ok: true, problems: [] })} onCopy={async (name) => ({ ...sample(name), origin: "user" })} onDelete={async () => ({ agent: null })} />);
    expect((await axe.run(container, NO_REGION)).violations).toEqual([]);
    unmount();
  }
});
