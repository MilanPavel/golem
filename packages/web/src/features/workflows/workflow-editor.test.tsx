import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import type { WorkflowCheckResult, WorkflowEditStepResult, WorkflowSaveResult } from "../../store/workflows.ts";
import { SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_ANSWER, SAMPLE_PR_DIGEST_EDITED_STEPS, SAMPLE_PR_DIGEST_HASH, SAMPLE_PR_DIGEST_PROBLEMS, SAMPLE_PR_DIGEST_PROPOSAL, SAMPLE_PR_DIGEST_PROPOSAL_PROBLEM, SAMPLE_PR_DIGEST_STEPS, SAMPLE_UNTRUSTED, WORKFLOWS_NOW, SAMPLE_UPGRADE, SAMPLE_UPGRADE_AGENTS, SAMPLE_UPGRADE_CODE, SAMPLE_UPGRADE_STEPS } from "./sample.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { WorkflowEditor, type WorkflowEditorProps } from "./workflow-editor.tsx";

type CheckFn = (code: string) => Promise<WorkflowCheckResult>;
type SaveFn = (code: string, base: string) => Promise<WorkflowSaveResult>;
const noContrast = { rules: { "color-contrast": { enabled: false } } };
const WAIT = { timeout: 4000 };

afterEach(() => vi.restoreAllMocks());

function editor(props: Partial<WorkflowEditorProps> = {}) {
  return <WorkflowEditor workflow={SAMPLE_PR_DIGEST} steps={SAMPLE_PR_DIGEST_STEPS} code={SAMPLE_PR_DIGEST_CODE} codeHash={SAMPLE_PR_DIGEST_HASH} {...props} />;
}

const saved = (code_hash: string, extra: Partial<WorkflowSaveResult> = {}): WorkflowSaveResult => ({ code_hash, problems: [], steps: SAMPLE_PR_DIGEST_STEPS, workflow: SAMPLE_PR_DIGEST, ...extra });

test("the outline is read from the code, numbered, with for each and if", () => {
  render(editor());
  const items = within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem");
  expect(items).toHaveLength(4);
  expect(items[1]!.textContent).toContain("2Summarise each pull request");
  expect(items[1]!.textContent).toContain("Once for each pulls");
  expect(items[3]!.textContent).toContain('if reviewed["verdict"] != "reject"');
});

test("a step shows its item after the title, and a group reads its title or At the same time", () => {
  const steps = [
    { id: "a", kind: "step", title: "Check folder", lines: [12, 12] as [number, number], item: "golem", group: "parallel-1", group_title: "Both folders" },
    { id: "b", kind: "step", title: "Check folder", lines: [13, 13] as [number, number], item: "web", group: "parallel-1", group_title: "Both folders" },
    { id: "c", kind: "llm", title: "Ask the model", lines: [15, 15] as [number, number], group: "parallel-2" },
    { id: "d", kind: "step", title: "Tidy", lines: [17, 17] as [number, number], for_each: "for each f in folders" },
  ];
  render(editor({ steps }));
  const list = within(screen.getByRole("list", { name: "Outline" }));
  const items = list.getAllByRole("listitem");
  expect(items[0]!.textContent).toContain("Both folders");
  expect(items[0]!.textContent).toContain("1Check foldergolem");
  expect(items[1]!.textContent).not.toContain("Both folders");
  expect(items[2]!.textContent).toContain("At the same time");
  expect(items[3]!.textContent).toContain("Once for each f in folders");
  expect(items[3]!.textContent).not.toContain("for each for each");
});

test("a step in the outline selects it, shows its fields and marks its lines", async () => {
  const user = userEvent.setup();
  render(editor());
  expect(screen.getByText(/Pick a step in the outline/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Summarise each pull request/ }));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  expect(pane.getByText("Model")).toBeTruthy();
  expect(pane.getByText("lines 15–17")).toBeTruthy();
  expect(pane.getByLabelText("Lines of the step").textContent).toContain("run.parallel(");
  expect(screen.getByRole("button", { name: /Summarise each pull request/ }).getAttribute("aria-current")).toBe("step");
});

test("picking a step scrolls the code to its first line, and the focus stays on the step", async () => {
  const user = userEvent.setup();
  const { container } = render(editor());
  const box = screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement;
  const card = screen.getByRole("button", { name: /Summarise each pull request/ });
  expect(box.scrollTop).toBe(0);
  await user.click(card);
  const first = box.scrollTop;
  expect(first).toBeGreaterThan(0);
  expect(document.activeElement).toBe(card);
  expect(box.selectionStart).toBe(0);
  // The selected step's band moves with the text, so it stays on the step's lines.
  expect(container.querySelector<HTMLElement>("[data-testid='code-editor-bands']")?.style.transform).toBe(`translateY(${-first}px)`);
  // A later step is further down.
  await user.click(screen.getByRole("button", { name: /Tell you/ }));
  expect(box.scrollTop).toBeGreaterThan(first);
});

test("the caret in a step's lines selects that step", async () => {
  render(editor());
  const box = screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement;
  const at = SAMPLE_PR_DIGEST_CODE.indexOf("run.review");
  box.focus();
  box.setSelectionRange(at, at);
  box.setSelectionRange(at, at);
  fireEvent.keyUp(box);
  await waitFor(() => expect(screen.getByRole("button", { name: /Check the digest/ }).getAttribute("aria-current")).toBe("step"));
});

test("the view toggle hides the code or the outline", async () => {
  const user = userEvent.setup();
  render(editor());
  await user.click(screen.getByRole("button", { name: "Steps" }));
  expect(screen.queryByRole("textbox", { name: "Code of pr_digest" })).toBeNull();
  expect(screen.getByRole("list", { name: "Outline" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Code" }));
  expect(screen.getByRole("textbox", { name: "Code of pr_digest" })).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Outline" })).toBeNull();
});

test("after a pause the code is checked, and an edit that removes a step redraws the outline", async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn<CheckFn>(async () => ({ problems: [], steps: SAMPLE_PR_DIGEST_EDITED_STEPS }));
  render(editor({ onCheck, onSave: async () => saved("h2") }));
  await waitFor(() => expect(screen.getByText("✓ checks pass")).toBeTruthy(), WAIT);
  onCheck.mockClear();
  await user.type(screen.getByRole("textbox", { name: "Code of pr_digest" }), "#");
  expect(screen.getByText("1 change not saved")).toBeTruthy();
  await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1), WAIT);
  expect(onCheck.mock.calls[0]![0]).toContain("#");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem")).toHaveLength(3));
});

test("problems show in a bar, on the step and as marks in the code", async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn<CheckFn>(async () => ({ problems: SAMPLE_PR_DIGEST_PROBLEMS, steps: SAMPLE_PR_DIGEST_STEPS }));
  const { container } = render(editor({ onCheck, onSave: async () => saved("h2") }));
  await user.type(screen.getByRole("textbox", { name: "Code of pr_digest" }), " ");
  await waitFor(() => expect(screen.getByText("✕ 2 problems, 1 warning")).toBeTruthy(), WAIT);
  const list = within(screen.getByRole("list", { name: "Problems" }));
  expect(list.getAllByRole("listitem")).toHaveLength(3);
  expect(list.getByText(/no agent "upgrader"/)).toBeTruthy();
  expect(list.getByText("line 15 · step 2")).toBeTruthy();
  // On the step it belongs to.
  expect(screen.getByRole("button", { name: /Summarise each pull request/ }).textContent).toContain('no agent "upgrader"');
  expect(container.querySelectorAll(".code-editor-band[data-kind='problem']")).toHaveLength(2);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("Save writes the code against the hash it started from, and ⌘S does the same", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<SaveFn>(async () => saved("h2"));
  render(editor({ onSave }));
  const box = screen.getByRole("textbox", { name: "Code of pr_digest" });
  await user.type(box, "#");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
  expect(onSave).toHaveBeenLastCalledWith(expect.stringContaining("#"), SAMPLE_PR_DIGEST_HASH);
  expect(screen.queryByText("1 change not saved")).toBeNull();
  // Nothing changed, so ⌘S writes nothing. The next save starts from the new hash.
  await user.keyboard("{Meta>}s{/Meta}");
  expect(onSave).toHaveBeenCalledTimes(1);
  await user.type(box, "!");
  await user.keyboard("{Meta>}s{/Meta}");
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1]![1]).toBe("h2");
});

test("a refused save shows the daemon's words as an error and keeps the edit", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => {
    throw new Error("the file changed on disk since you opened it");
  });
  render(editor({ onSave }));
  await user.type(screen.getByRole("textbox", { name: "Code of pr_digest" }), "#");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Not saved. the file changed on disk since you opened it");
  expect(screen.getByText("1 change not saved")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Revert" }));
  expect(screen.queryByText("1 change not saved")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("an untrusted workflow's code is read only, with no Save", () => {
  render(editor({ workflow: SAMPLE_UNTRUSTED, onSave: async () => saved("h2") }));
  expect((screen.getByRole("textbox", { name: "Code of deploy" }) as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.getByText(/The project is not trusted/)).toBeTruthy();
});

test("leaving with code not saved asks first, and an edit survives a look at another tab", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <WorkflowDetail
      workflow={SAMPLE_PR_DIGEST}
      steps={SAMPLE_PR_DIGEST_STEPS}
      code={SAMPLE_PR_DIGEST_CODE}
      codeHash={SAMPLE_PR_DIGEST_HASH}
      runs={[]}
      now={WORKFLOWS_NOW}
      onNavigate={onNavigate}
      onSave={async () => saved("h2")}
      initialTab="code"
    />,
  );
  await user.type(screen.getByRole("textbox", { name: "Code of pr_digest" }), "#");
  await user.click(screen.getByRole("tab", { name: "Triggers" }));
  await user.click(screen.getByRole("link", { name: "Routines" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onNavigate).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("link", { name: "Routines" }));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("tab", { name: "Code" }));
  expect((screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement).value.endsWith("#")).toBe(true);
});

type ProposeFn = NonNullable<WorkflowEditorProps["onPropose"]>;

test("asking golem shows the proposal as new steps and a diff, and writes nothing", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<SaveFn>(async () => saved("h2"));
  const onPropose = vi.fn<ProposeFn>(async () => SAMPLE_PR_DIGEST_PROPOSAL);
  render(editor({ onPropose, onSave }));
  await user.type(screen.getByRole("textbox", { name: "Ask golem to change this workflow" }), "make it cheaper");
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await screen.findByRole("group", { name: "Proposal" });
  expect(onPropose).toHaveBeenCalledWith(SAMPLE_PR_DIGEST_CODE, "make it cheaper", undefined);
  const proposal = within(screen.getByRole("group", { name: "Proposal" }));
  expect(proposal.getByText(/1 step added, 1 changed/)).toBeTruthy();
  expect(proposal.getByText(/capped each summary/)).toBeTruthy();
  const items = within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem");
  expect(items).toHaveLength(5);
  expect(items[1]!.textContent).toContain("Leave out drafts");
  expect(items[1]!.textContent).toContain("new");
  expect(items[2]!.textContent).toContain("changed");
  const diff = within(screen.getByRole("list", { name: "Diff" }));
  expect(diff.getByText(/Leave out drafts/).closest("li")!.textContent).toContain("+");
  expect(screen.getByText("✓ checks pass on the proposal")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Code of pr_digest" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

test("a suggested question asks at once", async () => {
  const onPropose = vi.fn<ProposeFn>(async () => SAMPLE_PR_DIGEST_PROPOSAL);
  render(editor({ onPropose, onSave: async () => saved("h2") }));
  await userEvent.setup().click(screen.getByRole("button", { name: "explain this workflow" }));
  expect(onPropose).toHaveBeenCalledWith(SAMPLE_PR_DIGEST_CODE, "explain this workflow", undefined);
});

test("Apply puts the proposal into the editor as an unsaved edit, and Save writes it", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<SaveFn>(async () => saved("h2"));
  render(editor({ onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, onSave, initial: { problems: [], ask: "drop drafts" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.click(await screen.findByRole("button", { name: "Apply" }));
  const box = screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement;
  expect(box.value).toBe(SAMPLE_PR_DIGEST_PROPOSAL.code);
  expect(screen.getByText(/changes? not saved/)).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Proposal" })).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(SAMPLE_PR_DIGEST_PROPOSAL.code, SAMPLE_PR_DIGEST_HASH));
});

test("Discard leaves the code as it was", async () => {
  const user = userEvent.setup();
  render(editor({ onSave: async () => saved("h2"), onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, initial: { problems: [], proposal: SAMPLE_PR_DIGEST_PROPOSAL } }));
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect((screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement).value).toBe(SAMPLE_PR_DIGEST_CODE);
  expect(screen.queryByText(/changes? not saved/)).toBeNull();
  expect(within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem")).toHaveLength(4);
});

test("Refine sends one more sentence with the proposal and its note", async () => {
  const user = userEvent.setup();
  const onPropose = vi.fn<ProposeFn>(async () => ({ ...SAMPLE_PR_DIGEST_PROPOSAL, note: "Also skipped bots." }));
  render(editor({ onSave: async () => saved("h2"), onPropose, initial: { problems: [], proposal: SAMPLE_PR_DIGEST_PROPOSAL } }));
  await user.click(screen.getByRole("button", { name: "Change it…" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "One more sentence on the proposal" }));
  await user.type(screen.getByRole("textbox", { name: "One more sentence on the proposal" }), "skip bots");
  await user.click(screen.getByRole("button", { name: "Refine" }));
  await screen.findByText(/Also skipped bots/);
  expect(onPropose).toHaveBeenCalledWith(SAMPLE_PR_DIGEST_CODE, "skip bots", { code: SAMPLE_PR_DIGEST_PROPOSAL.code, note: SAMPLE_PR_DIGEST_PROPOSAL.note });
});

test("while golem writes there is a Cancel, and a cancelled answer is dropped", async () => {
  const user = userEvent.setup();
  let answer: (result: typeof SAMPLE_PR_DIGEST_PROPOSAL) => void = () => undefined;
  const onPropose = vi.fn<ProposeFn>(() => new Promise((resolve) => (answer = resolve)));
  render(editor({ onSave: async () => saved("h2"), onPropose, initial: { problems: [], ask: "x" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByText(/golem is writing/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  answer(SAMPLE_PR_DIGEST_PROPOSAL);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole("group", { name: "Proposal" })).toBeNull();
  expect(screen.queryByText(/golem is writing/)).toBeNull();
});

test("a proposal with a problem shows the problem", async () => {
  const user = userEvent.setup();
  const { container } = render(editor({ onSave: async () => saved("h2"), onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL_PROBLEM, initial: { problems: [], ask: "x" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await screen.findByRole("group", { name: "Proposal" });
  expect(screen.getByRole("list", { name: "Problems" }).textContent).toContain('no agent "upgrader"');
  expect(screen.getByText("✕ 1 problem")).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("a proposal that leaves the file as it is is shown as an answer", async () => {
  const user = userEvent.setup();
  const onPropose = vi.fn<ProposeFn>(async () => ({ code: SAMPLE_PR_DIGEST_CODE, note: "It lists pull requests and sends a digest.", steps: SAMPLE_PR_DIGEST_STEPS, problems: [], model: "m" }));
  render(editor({ onSave: async () => saved("h2"), onPropose, initial: { problems: [], ask: "explain this workflow" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const answer = await screen.findByRole("group", { name: "Answer" });
  expect(answer.textContent).toContain("It lists pull requests");
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  await user.click(within(answer).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("group", { name: "Answer" })).toBeNull();
});

test("an answer is marked as changing nothing, has no Apply, and a step number selects the step", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<SaveFn>(async () => saved("h2"));
  const onPropose = vi.fn<ProposeFn>(async () => SAMPLE_PR_DIGEST_ANSWER);
  render(editor({ onSave, onPropose, initial: { problems: [] } }));
  await user.click(screen.getByRole("button", { name: "explain this workflow" }));
  const answer = within(await screen.findByRole("group", { name: "Answer" }));
  expect(answer.getByText("explain this workflow")).toBeTruthy();
  expect(answer.getByText("Answer · nothing is changed")).toBeTruthy();
  expect(answer.getByText(/asks a model to summarise each one/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  // The file is still in the editor, and no step is selected until a number is clicked.
  expect((screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement).value).toBe(SAMPLE_PR_DIGEST_CODE);
  expect(within(screen.getByRole("list", { name: "Outline" })).queryByRole("button", { current: "step" })).toBeNull();
  await user.click(answer.getAllByRole("button", { name: "step 2" })[0]!);
  expect(screen.getByRole("group", { name: "Selected step" }).textContent).toContain("Summarise each pull request");
  // The step is now selected, so it can be explained, and the answer can be closed.
  expect(screen.getByRole("button", { name: "explain step 2" })).toBeTruthy();
  await user.click(answer.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("group", { name: "Answer" })).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

test("a change names the new and changed steps, and Discard drops it", async () => {
  const user = userEvent.setup();
  render(editor({ onSave: async () => saved("h2"), onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, initial: { problems: [], ask: "make it cheaper" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const change = within(await screen.findByRole("group", { name: "Proposal" }));
  expect(change.getByText("Change · not saved yet")).toBeTruthy();
  expect(change.getByText("make it cheaper")).toBeTruthy();
  const listed = within(change.getByRole("list", { name: "What changes" })).getAllByRole("listitem");
  expect(listed.map((item) => item.textContent)).toEqual(["New · Leave out drafts", "Changed · Summarise each pull request"]);
  for (const name of ["Apply", "See the code change", "Change it…", "Discard"]) expect(change.getByRole("button", { name })).toBeTruthy();
  await user.click(change.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("group", { name: "Proposal" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Code of pr_digest" }) as HTMLTextAreaElement).value).toBe(SAMPLE_PR_DIGEST_CODE);
});

test("See the code change shows the diff from the outline view", async () => {
  const user = userEvent.setup();
  render(editor({ onSave: async () => saved("h2"), onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, initial: { problems: [], proposal: SAMPLE_PR_DIGEST_PROPOSAL, view: "outline" } }));
  expect(screen.queryByRole("list", { name: "Diff" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "See the code change" }));
  expect(screen.getByRole("list", { name: "Diff" })).toBeTruthy();
});

test("the suggestions follow the selected step, and there is one change to ask for", async () => {
  const onPropose = vi.fn<ProposeFn>(async () => SAMPLE_PR_DIGEST_ANSWER);
  render(editor({ onSave: async () => saved("h2"), onPropose, initial: { problems: [], selected: "s3" } }));
  expect(screen.getAllByRole("button").filter((b) => b.className.includes("rounded-full")).map((b) => b.textContent)).toEqual(["explain this workflow", "explain step 3", "make it cheaper"]);
  expect(screen.getByRole("textbox", { name: "Ask golem to change this workflow" }).getAttribute("placeholder")).toBe("Ask a question, or say what to change");
  await userEvent.setup().click(screen.getByRole("button", { name: "explain step 3" }));
  expect(onPropose).toHaveBeenCalledWith(SAMPLE_PR_DIGEST_CODE, "explain step 3", undefined);
});

test("a refused ask shows the daemon's words", async () => {
  const user = userEvent.setup();
  render(editor({ onSave: async () => saved("h2"), onPropose: () => Promise.reject(new Error("No model is available for this folder.")), initial: { problems: [], ask: "x" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect((await screen.findByRole("alert")).textContent).toBe("No model is available for this folder.");
});

test("an untrusted folder has no ask box", () => {
  render(editor({ workflow: SAMPLE_UNTRUSTED, onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, onSave: async () => saved("h2") }));
  expect(screen.queryByRole("textbox", { name: "Ask golem to change this workflow" })).toBeNull();
});

test("⌘K focuses the ask box", async () => {
  const user = userEvent.setup();
  render(editor({ onSave: async () => saved("h2"), onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL,  }));
  await user.click(screen.getByRole("textbox", { name: "Code of pr_digest" }));
  await user.keyboard("{Meta>}k{/Meta}");
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Ask golem to change this workflow" }));
});

type EditFn = (code: string, stepId: string, name: string, value: string) => Promise<WorkflowEditStepResult>;

function fieldsEditor(onEditStep: EditFn, extra: Partial<WorkflowEditorProps> = {}) {
  return <WorkflowEditor workflow={SAMPLE_UPGRADE} steps={SAMPLE_UPGRADE_STEPS} code={SAMPLE_UPGRADE_CODE} codeHash={SAMPLE_PR_DIGEST_HASH} onEditStep={onEditStep} onSave={async () => saved("h2")} agents={SAMPLE_UPGRADE_AGENTS} initial={{ selected: "agent:worker", problems: [] }} {...extra} />;
}

test("a field writes one argument: the daemon's text becomes an unsaved edit and the outline follows", async () => {
  const user = userEvent.setup();
  const edited = SAMPLE_UPGRADE_CODE.replace("Upgrade httpx. Fix what breaks.", "Upgrade httpx.");
  const steps = SAMPLE_UPGRADE_STEPS.map((step) => (step.id === "agent:worker" ? { ...step, title: "worker: Upgrade httpx." } : step));
  const onEditStep = vi.fn<EditFn>(async () => ({ code: edited, steps, problems: [] }));
  render(fieldsEditor(onEditStep));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  const brief = pane.getByLabelText("brief");
  await user.clear(brief);
  await user.type(brief, "Upgrade httpx.");
  await user.tab();
  await waitFor(() => expect(onEditStep).toHaveBeenCalledTimes(1));
  expect(onEditStep).toHaveBeenCalledWith(SAMPLE_UPGRADE_CODE, "agent:worker", "brief", "Upgrade httpx.");
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Code of upgrade" }) as HTMLTextAreaElement).value).toBe(edited));
  expect(screen.getByText("1 change not saved")).toBeTruthy();
  expect(screen.getByRole("button", { name: /worker: Upgrade httpx\./ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
});

test("the agent and the model are selects, and a change is sent at once", async () => {
  const user = userEvent.setup();
  const onEditStep = vi.fn<EditFn>(async (code) => ({ code, steps: SAMPLE_UPGRADE_STEPS, problems: [] }));
  const onOpenAgent = vi.fn();
  render(fieldsEditor(onEditStep, { onOpenAgent }));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  expect(within(pane.getByLabelText("agent")).getAllByRole("option").map((option) => option.textContent)).toEqual([...SAMPLE_UPGRADE_AGENTS]);
  expect(within(pane.getByLabelText("model")).getAllByRole("option").map((option) => option.textContent)).toEqual(["cheapest", "same", "stronger", "local", "budget", "frontier"]);
  await user.selectOptions(pane.getByLabelText("model"), "local");
  await waitFor(() => expect(onEditStep).toHaveBeenCalledWith(SAMPLE_UPGRADE_CODE, "agent:worker", "model", "local"));
  await user.selectOptions(pane.getByLabelText("agent"), "reviewer");
  await waitFor(() => expect(onEditStep).toHaveBeenCalledWith(SAMPLE_UPGRADE_CODE, "agent:worker", "type", "reviewer"));
  await user.click(pane.getByRole("button", { name: "agents/worker.md ↗" }));
  expect(onOpenAgent).toHaveBeenCalledWith("worker");
});

test("a field that was not changed writes nothing, and a missing one is added when set", async () => {
  const user = userEvent.setup();
  const onEditStep = vi.fn<EditFn>(async (code) => ({ code, steps: SAMPLE_UPGRADE_STEPS, problems: [] }));
  render(fieldsEditor(onEditStep));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  await user.click(pane.getByLabelText("brief"));
  await user.tab();
  expect(onEditStep).not.toHaveBeenCalled();
  expect(pane.getByText("Not written in the code. Ticking it adds it.")).toBeTruthy();
  await user.click(pane.getByRole("checkbox", { name: "Only once" }));
  await waitFor(() => expect(onEditStep).toHaveBeenCalledWith(SAMPLE_UPGRADE_CODE, "agent:worker", "key", "worker-upgrade-httpx-fix"));
});

test("a value the code computes is shown as source, set in code, and jumps to its line", async () => {
  const user = userEvent.setup();
  const onEditStep = vi.fn<EditFn>(async (code) => ({ code, steps: SAMPLE_UPGRADE_STEPS, problems: [] }));
  render(fieldsEditor(onEditStep, { initial: { selected: "agent:reviewer", problems: [] } }));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  expect(pane.queryByLabelText("brief")).toBeNull();
  expect(pane.getByText(`f"Check {fix['answer']}"`)).toBeTruthy();
  await user.click(pane.getByRole("button", { name: "Set brief in code, line 8" }));
  expect(onEditStep).not.toHaveBeenCalled();
});

test("a refused field shows the daemon's reason and the text stays", async () => {
  const user = userEvent.setup();
  const onEditStep = vi.fn<EditFn>(async () => {
    throw new Error("budget must be more than $0");
  });
  render(fieldsEditor(onEditStep));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  const budget = pane.getByLabelText("budget");
  await user.clear(budget);
  await user.type(budget, "$0{enter}");
  expect((await pane.findByRole("alert")).textContent).toContain("budget must be more than $0");
  expect((screen.getByRole("textbox", { name: "Code of upgrade" }) as HTMLTextAreaElement).value).toBe(SAMPLE_UPGRADE_CODE);
  expect(screen.queryByText("1 change not saved")).toBeNull();
});

test("a code step has no fields, and without onEditStep the fields are not offered", () => {
  const { unmount } = render(fieldsEditor(vi.fn<EditFn>(), { initial: { selected: "code-1", problems: [] } }));
  expect(screen.getByRole("group", { name: "Selected step" }).textContent).toContain("A code step has no fields to edit here");
  expect(screen.queryByLabelText("brief")).toBeNull();
  unmount();
  render(fieldsEditor(vi.fn<EditFn>(), { onEditStep: undefined }));
  expect(screen.queryByLabelText("brief")).toBeNull();
  expect(screen.getByRole("group", { name: "Selected step" }).textContent).toContain("Read only");
});

test("a step card says its kind in words, its repeat and its condition, and a group is a box with its count", () => {
  const steps = [
    { id: "a", kind: "step", title: "Check folder", lines: [12, 12] as [number, number], item: "golem", group: "parallel-1", group_title: "Both folders" },
    { id: "b", kind: "step", title: "Check folder", lines: [13, 13] as [number, number], item: "web", group: "parallel-1", group_title: "Both folders" },
    { id: "c", kind: "notify", title: "Tell me", lines: [17, 17] as [number, number], for_each: "f in folders", condition: "found" },
  ];
  render(editor({ steps }));
  const items = within(screen.getByRole("list", { name: "Outline" })).getAllByRole("listitem");
  expect(items[0]!.textContent).toContain("these 2 run at the same time");
  expect(items[1]!.textContent).not.toContain("run at the same time");
  expect(items[0]!.textContent).toContain("Python");
  expect(items[2]!.textContent).toContain("Inbox");
  expect(items[2]!.textContent).toContain("↻ Once for each f in folders");
  expect(items[2]!.textContent).not.toContain("kind");
});

test("the pane says what a step does, what it repeats and what it uses, and its code links to the file", async () => {
  const user = userEvent.setup();
  const steps = [
    { id: "a", kind: "step", title: "Read the list", lines: [12, 12] as [number, number], does: "Reads the list." },
    { id: "b", kind: "step", title: "Save it", lines: [13, 14] as [number, number], does: "Saves each item.", for_each: "item in items", after: ["a"] },
  ];
  render(editor({ steps, initial: { selected: "b", view: "outline" } }));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  expect(pane.getByText("Saves each item.")).toBeTruthy();
  expect(pane.getByText("Once for each item in items")).toBeTruthy();
  expect(pane.getByText("Read the list · step 1")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Code of pr_digest" })).toBeNull();
  await user.click(pane.getByRole("button", { name: "Show in the file" }));
  expect(screen.getByRole("textbox", { name: "Code of pr_digest" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Steps and code" }).getAttribute("aria-pressed")).toBe("true");
});
