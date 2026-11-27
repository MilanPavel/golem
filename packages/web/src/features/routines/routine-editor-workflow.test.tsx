import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { SAMPLE_PR_DIGEST, SAMPLE_WORKFLOW_LIST } from "../workflows/sample.ts";
import { RoutineDetail } from "./routine-detail.tsx";
import { RoutineEditor, type RoutineDraft, type RoutineEditorProps } from "./routine-editor.tsx";
import { ROUTINES_NOW, SAMPLE_MORNING_BRIEF, SAMPLE_WORKFLOW_ROUTINE } from "./sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const TIMES = ["2026-11-18T08:30:00+01:00", "2026-11-19T08:30:00+01:00", "2026-11-20T08:30:00+01:00"];
const WORKFLOWS = SAMPLE_WORKFLOW_LIST.workflows;
const WATCH_DRAFT: RoutineDraft = { name: "receipts", on: { watch: "~/Downloads", glob: "*.png" } };

function setup(extra: Partial<RoutineEditorProps> = {}, draft: RoutineDraft = {}) {
  const onSave = vi.fn<RoutineEditorProps["onSave"]>(async () => undefined);
  const view = render(
    <RoutineEditor
      create
      draft={draft}
      now={ROUTINES_NOW}
      skills={[]}
      servers={["github"]}
      workflows={WORKFLOWS}
      folderBrowser={() => <p>browser</p>}
      modelPick={() => <span>model</span>}
      onPreview={async () => TIMES}
      onSave={onSave}
      onCancel={() => {}}
      {...extra}
    />,
  );
  return { ...view, onSave };
}

const pick = (user: ReturnType<typeof userEvent.setup>, name: string) => user.selectOptions(screen.getByRole("combobox", { name: "Workflow" }), name);

test("A workflow lists the workflows, shows the inputs with their defaults, and Save writes workflow and inputs", async () => {
  const user = userEvent.setup();
  const { onSave, container } = setup({}, { name: "digest", schedule: "30 8 * * 1-5" });
  expect(screen.getByRole("textbox", { name: "Prompt" })).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "A workflow" }));
  expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  expect(screen.queryByText("Where and with what")).toBeNull();
  const options = within(screen.getByRole("combobox", { name: "Workflow" })).getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Choose…", "nightly", "hello", "pr_digest", "broken (does not load)"]);
  expect((options[4] as HTMLOptionElement).disabled).toBe(true);
  await pick(user, "pr_digest");
  expect((screen.getByRole("textbox", { name: /^since/ }) as HTMLInputElement).value).toBe("1d");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.type(screen.getByRole("textbox", { name: /^tool/ }), "gh");
  await user.type(screen.getByRole("textbox", { name: /^repo/ }), "MilanPavel/golem");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenLastCalledWith("digest", { workflow: "pr_digest", inputs: { tool: "gh", repo: "MilanPavel/golem", since: "1d" }, schedule: "30 8 * * 1-5", missed: "skip" });
});

test("a workflow routine opens with its workflow and inputs, and writes them back", async () => {
  const user = userEvent.setup();
  const { onSave } = setup({ create: false }, { ...SAMPLE_WORKFLOW_ROUTINE.config, inputs: { tool: "gh", repo: "a/b", since: "2d" } });
  expect((screen.getByRole("combobox", { name: "Workflow" }) as HTMLSelectElement).value).toBe("pr_digest");
  expect((screen.getByRole("textbox", { name: /^since/ }) as HTMLInputElement).value).toBe("2d");
  expect((screen.getByRole("textbox", { name: /^repo/ }) as HTMLInputElement).value).toBe("a/b");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).toMatchObject({ workflow: "pr_digest", inputs: { tool: "gh", repo: "a/b", since: "2d" } });
  expect(onSave.mock.calls[0]?.[1]).not.toHaveProperty("prompt");
});

test("switching a workflow routine back to a prompt removes workflow and inputs", async () => {
  const user = userEvent.setup();
  const { onSave } = setup({ create: false }, { ...SAMPLE_WORKFLOW_ROUTINE.config });
  await user.click(screen.getByRole("radio", { name: "A prompt" }));
  await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Do it");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).toMatchObject({ prompt: "Do it", workflow: null, inputs: null });
});

test("switching a prompt routine to a workflow removes its prompt, folder and servers", async () => {
  const user = userEvent.setup();
  const { onSave } = setup({ create: false }, { ...SAMPLE_MORNING_BRIEF.config });
  await user.click(screen.getByRole("radio", { name: "A workflow" }));
  await pick(user, "hello");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).toMatchObject({ workflow: "hello", prompt: null, folder: null, mcp: null });
  expect(onSave.mock.calls[0]?.[1]).not.toHaveProperty("inputs");
});

test("Save needs a workflow and the inputs it requires, and says so", async () => {
  const user = userEvent.setup();
  const { onSave } = setup({}, { name: "digest", schedule: "30 8 * * 1-5" });
  await user.click(screen.getByRole("radio", { name: "A workflow" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("Pick the workflow to run.")).toBeTruthy();
  await pick(user, "pr_digest");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("Fill in the inputs marked required.")).toBeTruthy();
  expect(screen.getAllByText("Required.")).toHaveLength(2);
  expect(onSave).not.toHaveBeenCalled();
});

test("the daemon's problems with the workflow and inputs show under the fields, and follow what is typed", async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn<NonNullable<RoutineEditorProps["onCheck"]>>(async () => ["input repo is required"]);
  setup({ onCheck }, { name: "digest", schedule: "30 8 * * 1-5", workflow: "pr_digest" });
  const problems = await screen.findByRole("list", { name: "Problems" });
  expect(within(problems).getByText("input repo is required")).toBeTruthy();
  expect(onCheck).toHaveBeenLastCalledWith({ workflow: "pr_digest", inputs: { since: "1d" }, onWatch: false });
  await user.type(screen.getByRole("textbox", { name: /^repo/ }), "a/b");
  await waitFor(() => expect(onCheck).toHaveBeenLastCalledWith({ workflow: "pr_digest", inputs: { repo: "a/b", since: "1d" }, onWatch: false }));
});

test("a refused check shows the daemon's reason", async () => {
  setup({ onCheck: () => Promise.reject(new Error("daemon down")) }, { name: "digest", schedule: "30 8 * * 1-5", workflow: "pr_digest" });
  expect((await screen.findByRole("list", { name: "Problems" })).textContent).toContain("daemon down");
});

test("a watch routine that runs a workflow says path is passed, and does not ask for it", async () => {
  const user = userEvent.setup();
  const sheet = { ...SAMPLE_PR_DIGEST, inputs: [{ name: "path", type: "folder" }, { name: "sheet", type: "str", default: '"S"' }] };
  const onCheck = vi.fn<NonNullable<RoutineEditorProps["onCheck"]>>(async () => []);
  const { onSave } = setup({ workflows: [sheet], onCheck, create: false }, { ...WATCH_DRAFT, workflow: "pr_digest", inputs: { sheet: "T" } });
  expect(screen.getByText(/Its full path is passed as the input path/)).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: /^path/ })).toBeNull();
  expect(screen.getByText("Runs the workflow pr_digest for each new PNG in ~/Downloads")).toBeTruthy();
  await waitFor(() => expect(onCheck).toHaveBeenCalledWith({ workflow: "pr_digest", inputs: { sheet: "T" }, onWatch: true }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).toMatchObject({ workflow: "pr_digest", inputs: { sheet: "T" }, on: { watch: "~/Downloads", glob: "*.png" } });
});

test("with no workflows, A workflow says there are none", async () => {
  const user = userEvent.setup();
  setup({ workflows: [] });
  await user.click(screen.getByRole("radio", { name: "A workflow" }));
  expect(screen.getByText(/No workflows yet/)).toBeTruthy();
});

test("a workflow routine's detail shows Workflow and its inputs instead of the prompt, and its TOML", async () => {
  const user = userEvent.setup();
  const { container } = render(<RoutineDetail routine={SAMPLE_WORKFLOW_ROUTINE} runs={[]} now={ROUTINES_NOW} onNavigate={() => {}} onRun={() => Promise.resolve({ routine_run_id: "r", session_id: "s" })} />);
  expect(screen.getByText("Workflow")).toBeTruthy();
  expect(screen.getByText("pr_digest")).toBeTruthy();
  expect(screen.getByText("repo=MilanPavel/golem, since=1d")).toBeTruthy();
  expect(screen.queryByText("Runs")).toBeNull();
  expect(screen.queryByText("MCP servers")).toBeNull();
  await user.click(screen.getByRole("tab", { name: "Config" }));
  expect(screen.getByLabelText("Config as TOML").textContent).toContain('workflow = "pr_digest"');
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("a workflow routine's detail links to its workflow's page when the workflow is known, and not when it is not", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const id = "/Users/you/.golem/workflows/pr_digest.py::pr_digest";
  const { rerender } = render(<RoutineDetail routine={SAMPLE_WORKFLOW_ROUTINE} workflowId={id} runs={[]} now={ROUTINES_NOW} onNavigate={onNavigate} onRun={() => Promise.resolve({ routine_run_id: "r", session_id: "s" })} />);
  const link = screen.getByRole("link", { name: /Open the workflow/ });
  expect(link.getAttribute("href")).toBe(`/workflows/${encodeURIComponent(id)}`);
  await user.click(link);
  expect(onNavigate).toHaveBeenCalledWith(`/workflows/${encodeURIComponent(id)}`);
  rerender(<RoutineDetail routine={SAMPLE_WORKFLOW_ROUTINE} runs={[]} now={ROUTINES_NOW} onNavigate={onNavigate} onRun={() => Promise.resolve({ routine_run_id: "r", session_id: "s" })} />);
  expect(screen.queryByRole("link", { name: /Open the workflow/ })).toBeNull();
});

test("a routine whose workflow is gone keeps its inputs and says it is not found", async () => {
  const user = userEvent.setup();
  const { onSave } = setup({ create: false, workflows: [] }, { name: "digest", schedule: "30 8 * * 1-5", workflow: "gone", inputs: { a: "1" } });
  expect(screen.getByRole("option", { name: "gone (not found)" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).toMatchObject({ workflow: "gone", inputs: { a: "1" } });
});
