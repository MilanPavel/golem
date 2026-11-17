import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { nextTimesText, routineToml } from "@golem/view";
import type { ListedSkill } from "../../store/skills.ts";
import { RoutineEditor, errorField, withSkill, type RoutineDraft, type RoutineEditorProps } from "./routine-editor.tsx";
import { ROUTINES_NOW, SAMPLE_MORNING_BRIEF } from "./sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const SKILLS: ListedSkill[] = [
  { name: "morning-brief", description: "Summarize the day's pull requests.", path: "/s/morning-brief", source: "user", usable: true, argument_hint: "[repo]" },
  { name: "triage", description: "Triage new issues.", path: "/s/triage", source: "user", usable: true },
  { name: "hidden", description: "Not for people.", path: "/s/hidden", source: "user", usable: true, user_invocable: false },
  { name: "broken", description: "Has errors.", path: "/s/broken", source: "user", usable: false },
];

const TIMES = ["2026-11-18T08:30:00+01:00", "2026-11-19T08:30:00+01:00", "2026-11-20T08:30:00+01:00"];

function setup(extra: Partial<RoutineEditorProps> = {}, draft: RoutineDraft = {}) {
  const onSave = vi.fn<RoutineEditorProps["onSave"]>(async () => undefined);
  const onPreview = vi.fn<RoutineEditorProps["onPreview"]>(async () => TIMES);
  const onCancel = vi.fn();
  const view = render(
    <RoutineEditor
      create
      draft={draft}
      now={ROUTINES_NOW}
      skills={SKILLS}
      servers={["github", "linear", "sentry"]}
      folderBrowser={({ onPick }) => <button type="button" onClick={() => onPick("/Users/me/src/app")}>Pick this folder</button>}
      modelPick={({ value, onPick }) => <button type="button" onClick={() => onPick("qwen3-coder:30b")}>{`Model: ${value ?? "Default"}`}</button>}
      onPreview={onPreview}
      onSave={onSave}
      onCancel={onCancel}
      {...extra}
    />,
  );
  return { ...view, onSave, onPreview, onCancel };
}

const repeat = () => within(screen.getByRole("radiogroup", { name: "Repeat" }));

test("each schedule option writes the right schedule", async () => {
  const user = userEvent.setup();
  const { onSave } = setup();
  await user.type(screen.getByRole("textbox", { name: "Name" }), "r");
  await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Do it");
  const cases: [string, () => Promise<void> | void, string][] = [
    ["Every day", () => {}, "30 8 * * *"],
    ["Weekdays", () => {}, "30 8 * * 1-5"],
    ["Weekly", () => user.click(within(screen.getByRole("radiogroup", { name: "On" })).getByRole("radio", { name: "Sun" })), "30 8 * * 0"],
    ["Every N hours", async () => {
      const hours = screen.getByRole("spinbutton", { name: "Every N hours" });
      await user.clear(hours);
      await user.type(hours, "6");
    }, "every 6h"],
    ["Cron", () => user.type(screen.getByRole("textbox", { name: "Cron" }), "0  17 * * 5"), "0 17 * * 5"],
  ];
  for (const [label, act, schedule] of cases) {
    await user.click(repeat().getByRole("radio", { name: label }));
    await act();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("r", expect.objectContaining({ schedule })));
  }
  expect(onSave).toHaveBeenCalledTimes(cases.length);
  // The time field is part of the schedule.
  await user.click(repeat().getByRole("radio", { name: "Weekdays" }));
  fireEvent.change(screen.getByLabelText("At"), { target: { value: "06:05" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("r", expect.objectContaining({ schedule: "5 6 * * 1-5" })));
  // "On new file" waits for file watching.
  expect(repeat().queryByRole("radio", { name: /new file/i })).toBeNull();
});

test("the preview asks the daemon, follows the schedule, and shows the next three times", async () => {
  const user = userEvent.setup();
  const { onPreview } = setup();
  expect(await screen.findByText(nextTimesText(TIMES, ROUTINES_NOW))).toBeTruthy();
  expect(nextTimesText(TIMES, ROUTINES_NOW)).toMatch(/^Next: \w{3} \d\d:\d\d · \w{3} \d\d:\d\d · \w{3} \d\d:\d\d$/);
  expect(onPreview).toHaveBeenLastCalledWith("30 8 * * 1-5");
  await user.click(repeat().getByRole("radio", { name: "Every day" }));
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith("30 8 * * *"));
  fireEvent.change(screen.getByLabelText("At"), { target: { value: "09:15" } });
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith("15 9 * * *"));
});

test("a bad cron shows the daemon's reason under the control", async () => {
  const user = userEvent.setup();
  const reason = "'61 * * * *' is outside the minute range 0-59";
  const onPreview = vi.fn<RoutineEditorProps["onPreview"]>(async () => Promise.reject(new Error(reason)));
  setup({ onPreview });
  await user.click(repeat().getByRole("radio", { name: "Cron" }));
  await user.type(screen.getByRole("textbox", { name: "Cron" }), "61 * * * *");
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith("61 * * * *"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(reason));
});

test("an empty cron says so on Save and does not ask the daemon", async () => {
  const user = userEvent.setup();
  const { onPreview, onSave } = setup();
  await user.click(repeat().getByRole("radio", { name: "Cron" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toBe("Write a cron line.");
  expect(onSave).not.toHaveBeenCalled();
  expect(onPreview).not.toHaveBeenCalledWith("");
});

test("the skill picker puts /name at the start of the prompt, in place of one that is there", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole("button", { name: "Insert a skill" }));
  const list = within(screen.getByRole("list", { name: "Skills" }));
  expect(list.getAllByRole("button").map((button) => button.textContent)).toEqual(["/morning-briefSummarize the day's pull requests.", "/triageTriage new issues."]);
  await user.click(list.getByRole("button", { name: /\/morning-brief/ }));
  const prompt = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
  expect(prompt.value).toBe("/morning-brief ");
  expect(screen.getByText("/morning-brief [repo]")).toBeTruthy();
  await user.type(prompt, "golem");
  await user.click(screen.getByRole("button", { name: "Insert a skill" }));
  await user.click(within(screen.getByRole("list", { name: "Skills" })).getByRole("button", { name: /\/triage/ }));
  expect(prompt.value).toBe("/triage golem");
});

test("withSkill and errorField", () => {
  expect(withSkill("", "a")).toBe("/a ");
  expect(withSkill("Look at PRs", "a")).toBe("/a Look at PRs");
  expect(withSkill("/b one two", "a")).toBe("/a one two");
  expect(withSkill("/b", "a")).toBe("/a");
  expect(errorField("schedule: bad")).toBe("schedule");
  expect(errorField("name: String should match pattern")).toBe("name");
  expect(errorField("/h/config.toml already has a routine called x")).toBe("name");
  expect(errorField("a routine needs exactly one of schedule and on")).toBe("schedule");
  expect(errorField("could not write /h/config.toml: disk full")).toBeNull();
});

test("the morning brief made only in the editor is the TOML of the example", async () => {
  const user = userEvent.setup();
  const { onSave } = setup();
  await user.type(screen.getByRole("textbox", { name: "Name" }), "morning-brief");
  await user.click(screen.getByRole("button", { name: "Insert a skill" }));
  await user.click(within(screen.getByRole("list", { name: "Skills" })).getByRole("button", { name: /\/morning-brief/ }));
  await user.click(screen.getByRole("button", { name: "Change…" }));
  await user.click(screen.getByRole("button", { name: "Pick this folder" }));
  await user.click(screen.getByRole("checkbox", { name: "github" }));
  await user.click(screen.getByRole("checkbox", { name: "linear" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const [name, fields] = onSave.mock.calls[0] ?? ["", {}];
  expect(fields).toEqual({ schedule: "30 8 * * 1-5", prompt: "/morning-brief", folder: "/Users/me/src/app", mcp: ["github", "linear"], missed: "skip" });
  expect(routineToml({ name, ...(fields as { prompt: string }) })).toBe(
    ['[[routine]]', 'name = "morning-brief"', 'schedule = "30 8 * * 1-5"', 'folder = "/Users/me/src/app"', 'mcp = ["github", "linear"]', 'missed = "skip"', 'prompt = "/morning-brief"'].join("\n"),
  );
});

test("Where and with what: the model and the missed choice are written", async () => {
  const user = userEvent.setup();
  const { onSave } = setup();
  await user.type(screen.getByRole("textbox", { name: "Name" }), "r");
  await user.type(screen.getByRole("textbox", { name: "Prompt" }), "x");
  await user.click(screen.getByRole("button", { name: "Model: Default" }));
  await user.click(within(screen.getByRole("radiogroup", { name: "When missed" })).getByRole("radio", { name: "Run once" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("r", { schedule: "30 8 * * 1-5", prompt: "x", model: "qwen3-coder:30b", missed: "run_once" }));
});

test("a refusal shows next to its field, and one about the routine at the foot", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<RoutineEditorProps["onSave"]>();
  onSave.mockRejectedValueOnce(new Error("name: String should match pattern '^[a-z0-9][a-z0-9-]{0,39}$'"));
  onSave.mockRejectedValueOnce(new Error("could not write /h/config.toml: disk full"));
  setup({ onSave });
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Bad Name");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const nameRow = screen.getByRole("textbox", { name: "Name" }).closest("li");
  expect((await within(nameRow as HTMLElement).findByRole("alert")).textContent).toContain("String should match pattern");
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Bad Name");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByText(/disk full/)).closest("li")).toBeNull();
  expect(within(nameRow as HTMLElement).queryByRole("alert")).toBeNull();
});

test("changing a routine keeps its schedule as written until a When control is used", async () => {
  const user = userEvent.setup();
  const draft = { ...SAMPLE_MORNING_BRIEF.config };
  const { onSave } = setup({ create: false }, draft);
  expect(repeat().getByRole("radio", { name: "Weekdays", checked: true })).toBeTruthy();
  expect((screen.getByLabelText("At") as HTMLInputElement).value).toBe("08:30");
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("/morning-brief");
  expect(screen.getByRole("checkbox", { name: "github" })).toHaveProperty("checked", true);
  expect(within(screen.getByRole("radiogroup", { name: "When missed" })).getByRole("radio", { name: "Run once", checked: true })).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "linear" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenLastCalledWith("morning-brief", {
    schedule: "weekdays 08:30",
    prompt: "/morning-brief",
    folder: "~/repos/golem",
    model: null,
    mcp: ["github"],
    missed: "run_once",
  });
  fireEvent.change(screen.getByLabelText("At"), { target: { value: "09:00" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("morning-brief", expect.objectContaining({ schedule: "0 9 * * 1-5" })));
});

test("a routine that starts on a new file shows its trigger and leaves the schedule alone", async () => {
  const user = userEvent.setup();
  const { onSave, onPreview } = setup({ create: false }, { name: "receipts", prompt: "File {path}", on: { watch: "~/Downloads", glob: "*.pdf" } });
  expect(screen.getByText("New *.pdf in ~/Downloads")).toBeTruthy();
  expect(screen.queryByRole("radiogroup", { name: "Repeat" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[1]).not.toHaveProperty("schedule");
  expect(onPreview).not.toHaveBeenCalled();
});

test("Cancel closes without saving, and the form has no axe violations", async () => {
  const user = userEvent.setup();
  const { onCancel, onSave, container } = setup();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
