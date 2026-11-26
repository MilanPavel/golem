import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import type { WorkflowCheckResult, WorkflowSaveResult } from "../../store/workflows.ts";
import { SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_EDITED_STEPS, SAMPLE_PR_DIGEST_HASH, SAMPLE_PR_DIGEST_PROBLEMS, SAMPLE_PR_DIGEST_PROPOSAL, SAMPLE_PR_DIGEST_PROPOSAL_PROBLEM, SAMPLE_PR_DIGEST_STEPS, SAMPLE_UNTRUSTED, WORKFLOWS_NOW } from "./sample.ts";
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
  expect(items[1]!.textContent).toContain("for each pulls");
  expect(items[3]!.textContent).toContain('if reviewed["verdict"] != "reject"');
});

test("a step in the outline selects it, shows its fields and marks its lines", async () => {
  const user = userEvent.setup();
  render(editor());
  expect(screen.getByText(/Pick a step in the outline/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Summarise each pull request/ }));
  const pane = within(screen.getByRole("group", { name: "Selected step" }));
  expect(pane.getByText("llm")).toBeTruthy();
  expect(pane.getByText("15–17")).toBeTruthy();
  expect(pane.getByLabelText("Lines of the step").textContent).toContain("run.parallel(");
  expect(screen.getByRole("button", { name: /Summarise each pull request/ }).getAttribute("aria-current")).toBe("step");
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
  await user.click(screen.getByRole("button", { name: "Outline" }));
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
  await user.click(screen.getByRole("button", { name: "make it cheaper" }));
  expect((screen.getByRole("textbox", { name: "Ask golem to change this workflow" }) as HTMLInputElement).value).toBe("make it cheaper");
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

test("Accept puts the proposal into the editor as an unsaved edit, and Save writes it", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<SaveFn>(async () => saved("h2"));
  render(editor({ onPropose: async () => SAMPLE_PR_DIGEST_PROPOSAL, onSave, initial: { problems: [], ask: "drop drafts" } }));
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.click(await screen.findByRole("button", { name: "Accept" }));
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
  await user.click(screen.getByRole("button", { name: "Refine…" }));
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
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  await user.click(within(answer).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("group", { name: "Answer" })).toBeNull();
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
