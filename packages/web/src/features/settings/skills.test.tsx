import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import type { ListedSkill } from "../../store/skills.ts";
import { fakeClient, fakeFrame, rpcError, summary, INVALID_PARAMS_CODE } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const FOLDER = "/Users/you/repos/golem";

const SHIP: ListedSkill = {
  name: "ship",
  description: "Take the changes to a pull request.",
  source: "project",
  path: `${FOLDER}/.agents/skills/ship`,
  usable: true,
  argument_hint: "[hint]",
  allowed_tools: ["Bash(git *)"],
  indexed: true,
};
const BRIEF: ListedSkill = { name: "morning-brief", description: "Brief.", source: "user", path: "/Users/you/.golem/skills/morning-brief", usable: true, argument_hint: "[repo]", warnings: ["`context` is ignored"] };
const SENTRY: ListedSkill = { name: "sentry-triage", description: "Triage.", source: "user", path: "/Users/you/.golem/skills/sentry-triage", usable: false, disabled: true };
const BROKEN: ListedSkill = {
  name: "broken-one",
  description: "",
  source: "user",
  path: "/Users/you/.golem/skills/broken-one",
  usable: false,
  errors: ["the frontmatter is not valid YAML: line 3: expected ',' or ']'"],
};
const HIDDEN: ListedSkill = { name: "ship", description: "Mine.", source: "user", path: "/Users/you/.golem/skills/ship", usable: false, shadowed_by: `${FOLDER}/.agents/skills/ship` };
const NOTES: ListedSkill = { name: "release-notes", description: "Write release notes.", source: "bundled", path: "/app/skills/release-notes", usable: true, argument_hint: "[since]" };
const SKILLS = [SHIP, BRIEF, SENTRY, BROKEN, HIDDEN, NOTES];

function mount(skills: ListedSkill[] = SKILLS) {
  history.replaceState(null, "", "/settings/skills");
  const fake = fakeClient();
  fake.raw.listSkills.mockResolvedValue({ skills });
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

const row = (name: string, word?: string) =>
  screen
    .getAllByRole("button")
    .find((button) => button.textContent?.startsWith(name) && (word === undefined || button.textContent.includes(word))) as HTMLElement;

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

test("the list is grouped as /skills groups it, with a count, a word per row, and unusable rows dimmed", async () => {
  mount();
  await screen.findByText("6 skills · 3 usable");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.firstChild?.textContent)).toEqual(["This project", "Yours", "Bundled with golem", "ship"]);
  expect(row("ship", "usable").textContent).toContain("/ship [hint]");
  expect(row("morning-brief").textContent).toContain("warnings");
  const sentry = row("sentry-triage");
  expect(sentry.textContent).toContain("disabled");
  expect(sentry.className).toContain("opacity-70");
  const broken = row("broken-one");
  expect(broken.textContent).toContain("broken");
  expect(broken.textContent).toContain("the frontmatter is not valid YAML");
  expect(row("ship", "hidden").textContent).toContain(`hidden by ${FOLDER}/.agents/skills/ship`);
  expect(row("release-notes").textContent).toContain("/release-notes [since]");
});

test("an empty list says how to add one", async () => {
  mount([]);
  expect(await screen.findByText("0 skills")).toBeTruthy();
  expect(screen.getByText(/Add one as ~\/\.golem\/skills/)).toBeTruthy();
});

test("a skill.registry.changed event reads the list again", async () => {
  const { fake } = mount();
  await screen.findByText("6 skills · 3 usable");
  fake.raw.listSkills.mockResolvedValue({ skills: [SHIP] });
  act(() => {
    fake.emitSkills(null);
  });
  expect(await screen.findByText("1 skill")).toBeTruthy();
});

test("the detail shows the facts, the errors and the warnings, in full paths", async () => {
  const { user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(row("broken-one"));
  expect(screen.getByRole("heading", { level: 3, name: "broken-one" })).toBeTruthy();
  const errors = screen.getByRole("region", { name: "Errors" });
  expect(errors.textContent).toContain("the frontmatter is not valid YAML");
  expect(screen.getAllByText("broken: never used").length).toBeGreaterThan(0);
  expect(screen.getByText("/Users/you/.golem/skills/broken-one", { selector: "span" })).toBeTruthy();
  await user.click(row("morning-brief"));
  expect(screen.getByRole("region", { name: "Warnings" }).textContent).toContain("`context` is ignored");
});

test("Disable and Enable call skill.set_disabled", async () => {
  const { fake, user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(row("morning-brief"));
  await user.click(screen.getByRole("button", { name: "More actions for morning-brief" }));
  await user.click(await screen.findByRole("menuitem", { name: "Disable" }));
  expect(fake.raw.setSkillDisabled).toHaveBeenCalledWith("morning-brief", true);
  await user.click(row("sentry-triage"));
  await user.click(screen.getByRole("button", { name: "More actions for sentry-triage" }));
  await user.click(await screen.findByRole("menuitem", { name: "Enable" }));
  expect(fake.raw.setSkillDisabled).toHaveBeenCalledWith("sentry-triage", false);
});

test("Run in a new chat opens the empty screen with /name in the composer", async () => {
  const { user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(row("ship", "usable"));
  await user.click(screen.getByRole("button", { name: "Run in a new chat" }));
  expect(location.pathname).toBe("/");
  const composer = (await screen.findByRole("textbox", { name: /message/i })) as HTMLTextAreaElement;
  expect(composer.textContent || composer.value).toContain("/ship ");
});

test("Pin in this chat calls session.set_skills for the session Settings came from", async () => {
  const { fake, user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(row("ship", "usable"));
  await user.click(screen.getByRole("button", { name: "Pin in this chat" }));
  expect(fake.raw.setSkills).toHaveBeenCalledWith("a", { pin: ["ship"] });
});

async function openEditor(name: string, text: string, over: Partial<{ source: "user" | "project" | "bundled"; path: string }> = {}) {
  const made = mount();
  made.fake.raw.readSkill.mockResolvedValue({ path: `/Users/you/.golem/skills/${name}/SKILL.md`, text, mtime_ns: 7, source: "user", ...over });
  await screen.findByText("6 skills · 3 usable");
  await made.user.click(row(name));
  await made.user.click(screen.getByRole("tab", { name: "SKILL.md" }));
  const box = (await screen.findByRole("textbox", { name: `${name} SKILL.md` })) as HTMLTextAreaElement;
  return { ...made, box };
}

test("a broken text disables Save and shows the line", async () => {
  const { fake, user, box } = await openEditor("morning-brief", "---\nname: x\n");
  fake.raw.writeSkill.mockResolvedValue({ ok: true, written: false, errors: [{ line: 3, message: "expected ',' or ']'" }], mtime_ns: 7 });
  await user.type(box, "!");
  const strip = await screen.findByRole("alert", { name: "Errors" });
  expect(strip.textContent).toContain("line 3: expected ',' or ']'");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Not saved · the registry reloads on save")).toBeTruthy();
});

test("a good save calls skill.write with base_mtime_ns, and a dry run first", async () => {
  const { fake, user, box } = await openEditor("morning-brief", "---\nname: morning-brief\n---\n");
  fake.raw.writeSkill.mockResolvedValue({ ok: true, written: false, mtime_ns: 7 });
  await user.type(box, "x");
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(fake.raw.writeSkill).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, baseMtimeNs: 7, text: "---\nname: morning-brief\n---\nx" }));
  fake.raw.writeSkill.mockResolvedValue({ ok: true, written: true, mtime_ns: 8 });
  await user.click(save);
  await waitFor(() =>
    expect(fake.raw.writeSkill).toHaveBeenLastCalledWith({
      path: "/Users/you/.golem/skills/morning-brief/SKILL.md",
      text: "---\nname: morning-brief\n---\nx",
      baseMtimeNs: 7,
      dryRun: false,
      cwd: FOLDER,
    }),
  );
  expect(await screen.findByText("Saved. The registry reloaded.")).toBeTruthy();
});

test("a save that hits a changed file says so and offers Reload", async () => {
  const { fake, user, box } = await openEditor("morning-brief", "a");
  fake.raw.writeSkill.mockResolvedValue({ ok: true, written: false, mtime_ns: 7 });
  await user.type(box, "b");
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fake.raw.writeSkill.mockResolvedValue({ ok: false, written: false, errors: [{ message: "SKILL.md changed on disk; reload" }] });
  await user.click(save);
  const alert = await screen.findByText(/changed on disk since you opened it/);
  expect(alert).toBeTruthy();
  const reads = fake.raw.readSkill.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Reload the file" }));
  await waitFor(() => expect(fake.raw.readSkill.mock.calls.length).toBe(reads + 1));
});

test("a project skill of a project that is not trusted says so in plain words", async () => {
  const { fake, user } = await (async () => {
    const made = mount();
    made.fake.raw.readSkill.mockResolvedValue({ path: `${FOLDER}/.agents/skills/ship/SKILL.md`, text: "x", mtime_ns: 3, source: "project" });
    made.fake.raw.writeSkill.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, `${FOLDER} is not in trusted_projects: trust it before the browser edits its skills`));
    await screen.findByText("6 skills · 3 usable");
    await made.user.click(row("ship", "usable"));
    await made.user.click(screen.getByRole("tab", { name: "SKILL.md" }));
    await screen.findByRole("textbox", { name: "ship SKILL.md" });
    return made;
  })();
  const alert = await screen.findByText("Trust this project to edit its skills from the browser, or edit it in the terminal.");
  expect(alert.textContent).not.toContain("trusted_projects");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fake.raw.writeSkill).toHaveBeenCalled();
  void user;
});

test("a bundled skill has no Edit and no Save: it offers Copy to Yours, which creates and writes", async () => {
  const { fake, user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(row("release-notes"));
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  fake.raw.readSkill.mockResolvedValue({ path: "/app/skills/release-notes/SKILL.md", text: "---\nname: release-notes\n---\nbody", mtime_ns: 1, source: "bundled" });
  fake.raw.createSkill.mockResolvedValue({ path: "/Users/you/.golem/skills/release-notes/SKILL.md", mtime_ns: 5 });
  await user.click(screen.getByRole("tab", { name: "SKILL.md" }));
  expect(await screen.findByText("Bundled with golem: copy it to Yours to change it.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await user.click(screen.getAllByRole("button", { name: "Copy to Yours" })[0] as HTMLElement);
  await waitFor(() => expect(fake.raw.writeSkill).toHaveBeenCalled());
  expect(fake.raw.createSkill).toHaveBeenCalledWith({ name: "release-notes", description: "Write release notes.", scope: "user", modelInvocable: true });
  expect(fake.raw.writeSkill).toHaveBeenCalledWith({
    path: "/Users/you/.golem/skills/release-notes/SKILL.md",
    text: "---\nname: release-notes\n---\nbody",
    baseMtimeNs: 5,
    cwd: FOLDER,
    dryRun: false,
  });
});

test("New skill: both places call skill.create, and Write it myself opens the SKILL.md tab", async () => {
  const { fake, user } = mount();
  await screen.findByText("6 skills · 3 usable");
  await user.click(screen.getByRole("button", { name: /New skill/ }));
  const dialog = await screen.findByRole("dialog", { name: "New skill" });
  expect((within(dialog).getByRole("button", { name: "Ask golem to write it" }) as HTMLButtonElement).disabled).toBe(true);
  const write = within(dialog).getByRole("button", { name: "Write it myself" }) as HTMLButtonElement;
  expect(write.disabled).toBe(true);
  await user.type(within(dialog).getByLabelText("Name"), "Bad Name");
  expect(within(dialog).getByText("Use lowercase letters, digits and dashes.")).toBeTruthy();
  await user.clear(within(dialog).getByLabelText("Name"));
  await user.type(within(dialog).getByLabelText("Name"), "my-skill");
  await user.type(within(dialog).getByLabelText("Description"), "Does a thing.");
  await user.click(within(dialog).getByRole("switch", { name: "Let the model use it" }));
  await user.click(write);
  await waitFor(() => expect(fake.raw.createSkill).toHaveBeenCalledWith({ name: "my-skill", description: "Does a thing.", scope: "user", modelInvocable: false }));

  await user.click(screen.getByRole("button", { name: /New skill/ }));
  const again = await screen.findByRole("dialog", { name: "New skill" });
  await user.click(within(again).getByRole("button", { name: "This project" }));
  await user.type(within(again).getByLabelText("Name"), "proj-skill");
  await user.type(within(again).getByLabelText("Description"), "For the project.");
  await user.click(within(again).getByRole("button", { name: "Write it myself" }));
  await waitFor(() =>
    expect(fake.raw.createSkill).toHaveBeenLastCalledWith({ name: "proj-skill", description: "For the project.", scope: "project", cwd: FOLDER, modelInvocable: true }),
  );
});

test("New skill in a project that is not trusted shows the plain refusal", async () => {
  const { fake, user } = mount();
  await screen.findByText("6 skills · 3 usable");
  fake.raw.createSkill.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, `${FOLDER} is not in trusted_projects: trust it before the browser edits its skills`));
  await user.click(screen.getByRole("button", { name: /New skill/ }));
  const dialog = await screen.findByRole("dialog", { name: "New skill" });
  await user.click(within(dialog).getByRole("button", { name: "This project" }));
  await user.type(within(dialog).getByLabelText("Name"), "proj-skill");
  await user.type(within(dialog).getByLabelText("Description"), "For the project.");
  await user.click(within(dialog).getByRole("button", { name: "Write it myself" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("Trust this project to edit its skills from the browser, or edit it in the terminal.");
});

test("frontmatter text is shown as text, never as markup", async () => {
  mount([{ ...SHIP, description: "<img src=x onerror=alert(1)> **bold**", errors: ["<b>bad</b>"], usable: false }]);
  await screen.findByText("1 skill · 0 usable");
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("b")).toBeNull();
  expect(screen.getAllByText(/<b>bad<\/b>/).length).toBeGreaterThan(0);
});

test("axe is clean in both themes, on the list, the overview and the editor", async () => {
  const { container, user, fake } = mount();
  await screen.findByText("6 skills · 3 usable");
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  }
  fake.raw.readSkill.mockResolvedValue({ path: `${FOLDER}/.agents/skills/ship/SKILL.md`, text: "---\nname: ship\n---\n", mtime_ns: 1, source: "project" });
  await user.click(screen.getByRole("tab", { name: "SKILL.md" }));
  await screen.findByRole("textbox", { name: "ship SKILL.md" });
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  }
});
