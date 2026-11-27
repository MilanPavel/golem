import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery's Workflows section shows the panels and a detail for each tab and state", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Workflows, slip" }));
  expect(panel.getByText("This project")).toBeTruthy();
  expect(panel.getByText("Yours")).toBeTruthy();
  expect(panel.getByRole("link", { name: /broken/ }).textContent).toContain("ImportError");
  expect(within(screen.getByRole("complementary", { name: "Workflows, two projects, slip" })).getByRole("link", { name: /deploy/ }).textContent).toContain("not trusted");
  expect(within(screen.getByRole("complementary", { name: "Workflows, empty, slip" })).getByText(/No workflows yet/)).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Workflows, loading, slip" })).getByText("Loading workflows.")).toBeTruthy();
  const code = within(screen.getByRole("region", { name: "Workflow detail, Code, slip" }));
  expect(code.getByRole("textbox", { name: "Code of pr_digest" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, Runs, slip" })).getByRole("list", { name: "Runs" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, Runs, none yet, slip" })).getByText("No runs yet.")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Workflow detail, broken, slip" })).getByRole("alert").textContent).toContain("ImportError");
});

test("the gallery's Triggers stories and the routine editor stories show each state, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery />);
    const story = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    const rows = story("Workflow detail, Triggers").getAllByRole("listitem");
    expect(rows.map((row) => row.textContent).join("|")).toContain("weekday-pr-digest");
    expect(story("Workflow detail, Triggers, none").getByText(/No routine starts this workflow/)).toBeTruthy();
    expect(story("Routine detail, workflow").getByText("repo=MilanPavel/golem, since=1d")).toBeTruthy();
    expect((story("Routine editor, workflow, inputs filled").getByRole("combobox", { name: "Workflow" }) as HTMLSelectElement).value).toBe("pr_digest");
    expect(story("Routine editor, workflow, required input missing").getByText("Fill in the inputs marked required.")).toBeTruthy();
    expect(story("Routine editor, workflow, required input missing").getAllByText("Required.").length).toBeGreaterThan(0);
    expect(story("Routine editor, workflow, daemon problems").getByRole("list", { name: "Problems" }).textContent).toContain("input repo is required");
    expect(story("Routine editor, workflow, watch folder").getByText(/Its full path is passed as the input path/)).toBeTruthy();
    expect(story("Routine editor, workflow, none picked").getByText("Pick the workflow to run.")).toBeTruthy();
    expect(story("Routine editor, prompt").getByRole("textbox", { name: "Prompt" })).toBeTruthy();
    // A routine's workflow run reads as the routine, with the workflow named after it.
    const run = story("Runs list, routine workflow run").getByRole("link");
    expect(run.textContent).toContain("weekday-pr-digest");
    expect(run.textContent).toContain("workflow pr_digest");
    expect(run.textContent).toContain("by schedule");
    unmount();
  }
});

test("the gallery's Workflow editor stories show each state, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { container, unmount } = render(<Gallery />);
    // A selector on the region finds a story at once; a role query over the whole gallery is slow.
    const story = (name: string) => {
      const region = container.querySelector<HTMLElement>(`[role="region"][aria-label="${name}, ${theme}"]`);
      if (region === null) throw new Error(`no story ${name}`);
      return within(region);
    };
    expect(story("Workflow editor, clean").getByText("✓ checks pass")).toBeTruthy();
    expect(within(story("Workflow editor, clean").getByRole("list", { name: "Outline" })).getAllByRole("listitem")).toHaveLength(4);
    expect(story("Workflow editor, edited, not saved").getByText("1 change not saved")).toBeTruthy();
    expect(within(story("Workflow editor, edited, not saved").getByRole("list", { name: "Outline" })).getAllByRole("listitem")).toHaveLength(3);
    expect(story("Workflow editor, problems").getByText("✕ 2 problems, 1 warning")).toBeTruthy();
    expect(story("Workflow editor, problems").getByRole("list", { name: "Problems" }).textContent).toContain('no agent "upgrader"');
    expect(story("Workflow editor, conflict").getByRole("alert").textContent).toContain("The file changed on disk");
    expect(story("Workflow editor, selected step").getByRole("group", { name: "Selected step" }).textContent).toContain("Summarise each pull request");
    expect(story("Workflow editor, outline only").queryByRole("textbox")).toBeNull();
    expect(story("Workflow editor, broken file").getByRole("alert").textContent).toContain("ImportError");
    const ask = (name: string) => story(`Workflow editor, ask golem, ${name}`);
    expect((ask("asking").getByRole("textbox", { name: "Ask golem to change this workflow" }) as HTMLInputElement).value).toBe("add a step after 1");
    expect(ask("writing").getByText(/golem is writing/)).toBeTruthy();
    expect(ask("answer").getByText("Answer · nothing is changed")).toBeTruthy();
    expect(ask("answer").getAllByRole("button", { name: "step 2" })).toHaveLength(2);
    expect(ask("answer").queryByRole("button", { name: "Apply" })).toBeNull();
    expect(ask("proposal with checks passing").getByText("Change · not saved yet")).toBeTruthy();
    expect(ask("proposal with checks passing").getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(ask("proposal with checks passing").getByText("✓ checks pass on the proposal")).toBeTruthy();
    expect(within(ask("proposal with checks passing").getByRole("list", { name: "Outline" })).getAllByRole("listitem")).toHaveLength(5);
    expect(ask("proposal with checks passing").getByRole("list", { name: "Diff" }).textContent).toContain("Leave out drafts");
    expect(ask("proposal with a problem").getByRole("list", { name: "Problems" }).textContent).toContain('no agent "upgrader"');
    expect(ask("refine").getByRole("textbox", { name: "One more sentence on the proposal" })).toBeTruthy();
    expect(ask("no model").getByRole("alert").textContent).toContain("No model is available");
    expect((story("Workflow editor, untrusted, read only").getByRole("textbox", { name: "Code of deploy" }) as HTMLTextAreaElement).readOnly).toBe(true);
    const stepsView = story("Workflow editor, outline only").getByRole("group", { name: "Selected step" });
    expect(stepsView.textContent).toContain("Asks you to look at the digest before it goes out.");
    expect(stepsView.textContent).toContain("Summarise each pull request · step 2");
    const fields = story("Step fields, agent step").getByRole("group", { name: "Selected step" });
    expect((within(fields).getByLabelText("brief") as HTMLTextAreaElement).value).toBe("Upgrade httpx. Fix what breaks.");
    expect((within(fields).getByLabelText("agent") as HTMLSelectElement).value).toBe("worker");
    expect((within(fields).getByLabelText("model") as HTMLSelectElement).value).toBe("cheapest");
    expect((within(fields).getByLabelText("budget") as HTMLInputElement).value).toBe("$0.50");
    expect((within(fields).getByRole("checkbox", { name: "Only once" }) as HTMLInputElement).checked).toBe(false);
    const computed = story("Step fields, a value the code computes").getByRole("group", { name: "Selected step" });
    expect(computed.textContent).toContain("f\"Check {fix['answer']}\"");
    expect(within(computed).getByRole("button", { name: "Set brief in code, line 8" })).toBeTruthy();
    expect(story("Step fields, code step").getByRole("group", { name: "Selected step" }).textContent).toContain("A code step has no fields");
    expect(story("Step fields, a field refused").getByRole("alert").textContent).toContain("model is a wish");
    unmount();
  }
});

test("the gallery's Run dialog stories show each state, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { unmount } = render(<Gallery />);
    const story = (name: string) => within(screen.getByRole("region", { name: `${name}, ${theme}` }));
    expect(story("Run dialog, defaults filled").getByRole("button", { name: "Run" })).toBeTruthy();
    expect(story("Run dialog, required missing").getAllByText("Required.")).toHaveLength(2);
    expect(story("Run dialog, every input type").getByLabelText("dry")).toBeTruthy();
    expect(story("Run dialog, bad number and error from the start").getByText("Enter a number.")).toBeTruthy();
    expect((story("Run dialog, starting").getByRole("button", { name: "Starting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(story("Run dialog, no inputs").getByText(/takes no inputs/)).toBeTruthy();
    unmount();
  }
});

test("the gallery's Workflow run section shows each state, in both themes", () => {
  const { container } = render(<Gallery />);
  // A role query over the whole gallery is slow; the stories are named with aria-label, so a selector finds them at once.
  const region = (name: string): HTMLElement => {
    const found = container.querySelector<HTMLElement>(`[role="region"][aria-label="${name}"]`);
    if (!found) throw new Error(`No region named ${name}`);
    return found;
  };
  for (const theme of ["slip", "kiln"] as const) {
    for (const title of [
      "Workflow run, running",
      "Workflow run, waiting for a review",
      "Workflow run, tool ask and worker row",
      "Workflow run, failed",
      "Workflow run, cancelled",
      "Workflow run, done, agent and worker rows",
    ]) {
      expect(region(`${title}, ${theme}`), title).toBeTruthy();
    }
    expect(within(region(`Workflow run, waiting for a review, ${theme}`)).getByRole("region", { name: "Review, Send this digest?" })).toBeTruthy();
    expect(within(region(`Workflow run, tool ask and worker row, ${theme}`)).getByRole("region", { name: "Review, Run gh_pr_create?" })).toBeTruthy();
    expect(within(region(`Workflow run, failed, ${theme}`)).getByRole("button", { name: "Resume" })).toBeTruthy();
  }
});

test("the gallery's starter stories show the empty page, a project starter, no folder, a refusal and the section, in both themes", () => {
  for (const theme of ["slip", "kiln"] as const) {
    showTheme(theme);
    const { container, unmount } = render(<Gallery />);
    const story = (name: string) => {
      const region = container.querySelector<HTMLElement>(`[role="region"][aria-label="${name}, ${theme}"]`);
      if (region === null) throw new Error(`no story ${name}`);
      return within(region);
    };
    const nothing = story("Workflows, nothing yet");
    expect(nothing.getByRole("heading", { name: "No workflows yet" })).toBeTruthy();
    expect(nothing.getByText(/leave one short briefing/)).toBeTruthy();
    expect(story("Workflows, nothing yet, project starter").getAllByRole("button", { name: "Use this starter" }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    const noFolder = story("Workflows, nothing yet, no folder");
    expect(noFolder.getAllByRole("button", { name: "Use this starter" }).filter((button) => (button as HTMLButtonElement).disabled)).toHaveLength(1);
    expect(story("Workflows, nothing yet, add refused").getByRole("alert").textContent).toContain("exists already");
    expect(story("Workflows, starters left").getByRole("heading", { name: "Starters" })).toBeTruthy();
    unmount();
  }
});
