import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import type { WorkflowCheckResult, WorkflowSaveResult } from "../../store/workflows.ts";
import { SAMPLE_PR_DIGEST, SAMPLE_PR_DIGEST_CODE, SAMPLE_PR_DIGEST_EDITED_STEPS, SAMPLE_PR_DIGEST_HASH, SAMPLE_PR_DIGEST_PROBLEMS, SAMPLE_PR_DIGEST_STEPS, SAMPLE_UNTRUSTED, WORKFLOWS_NOW } from "./sample.ts";
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
