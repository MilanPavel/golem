import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { SETUP_CASES } from "../features/setup/sample.ts";
import { Gallery } from "./gallery.tsx";

// Each test renders the whole gallery, in both themes, and axe walks all of it. On a shared CI
// runner that now takes over 20 s, while other files keep the shorter limit from vite.config.ts.
vi.setConfig({ testTimeout: 60_000 });

test("the gallery shows both themes and has no accessibility violations", async () => {
  const { container } = render(<Gallery />);
  expect(container.querySelector('[data-theme="slip"]')).toBeTruthy();
  expect(container.querySelector('[data-theme="kiln"]')).toBeTruthy();
  const results = await axe.run(container, {
    // jsdom does not compute colors, so contrast cannot be checked here.
    // tokens.test.ts checks every text and background pair in both themes.
    // Each trace demo repeats the same "Context window" landmark, so unique landmark names are not checked here.
    rules: { "color-contrast": { enabled: false }, "landmark-unique": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});

test("the gallery's model dialog shows a download with its speed and time left, and passes axe", async () => {
  const user = userEvent.setup();
  render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Download in progress, slip" }));
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(dialog.textContent).toContain("2.1 / 6.6 GB · 12 MB/s · 6 min");
  expect(dialog.textContent).toContain("Download failed: no space left on device");
  const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(results.violations).toEqual([]);
});

for (const theme of ["slip", "kiln"]) {
  for (const label of ["Tune view", "Tune view, a model that is not the session's"]) {
    test(`the gallery's "${label}" in ${theme} lists every option and passes axe`, async () => {
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      expect(await within(dialog).findAllByRole("slider")).toHaveLength(8);
      expect(within(dialog).getByRole("combobox", { name: "Keep loaded" })).toBeTruthy();
      expect(within(dialog).getByRole("button", { name: "Creative" })).toBeTruthy();
      expect(dialog.textContent).toContain("+0.0 GB · fits");
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}

for (const theme of ["slip", "kiln"]) {
  for (const [label, text] of [
    ["Tune view, try again", null],
    ["Tune view, no question to try", "Ask something first, then try again."],
    ["Tune view, chat running", "Wait for the answer, then try again."],
    ["Tune view, a try streaming", "A mutex lets one thread hold a resource"],
    ["Tune view, a try done", "The others wait their turn."],
    ["Tune view, a try failed", "The model did not answer."],
  ] as const) {
    test(`the gallery's "${label}" in ${theme} shows Try again and passes axe`, async () => {
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      const button = (await within(dialog).findByRole("button", { name: "Try again with these settings" })) as HTMLButtonElement;
      expect(button.disabled).toBe(label === "Tune view, no question to try" || label === "Tune view, chat running");
      if (text !== null) expect(dialog.textContent).toContain(text);
      if (label.includes("a try")) expect(within(dialog).getByRole("link", { name: "Open the try session" })).toBeTruthy();
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}

test("the gallery's Commands dialog lists the groups and passes axe", async () => {
  const user = userEvent.setup();
  render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Commands, kiln" }));
  const dialog = await screen.findByRole("dialog", { name: "Commands" });
  expect(dialog.textContent).toContain("In the terminal for now");
  const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(results.violations).toEqual([]);
});

// One test per state: each axe run takes seconds on CI, so a loop over them all outlasts the timeout.
for (const theme of ["slip", "kiln"]) {
  for (const { label } of SETUP_CASES) {
    test(`the gallery's setup window, ${label}, in ${theme} passes axe`, async () => {
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `Setup, ${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Setup" });
      if (label === "Overview") expect(dialog.textContent).toContain("not kept at login");
      if (label === "Engine, guided") expect(within(dialog).getByRole("list", { name: "Setup steps" })).toBeTruthy();
      if (label === "Ollama installing") expect(dialog.textContent).toContain("==> Pouring");
      if (label === "Ollama, no Homebrew") expect(within(dialog).getByRole("link", { name: "Open ollama.com/download" })).toBeTruthy();
      if (label === "Key") expect(dialog.textContent).toContain("golem auth set anthropic");
      if (label === "Model, downloading") expect(dialog.textContent).toContain("2.1 / 6.6 GB · 12 MB/s");
      if (label === "Model, download failed") expect(dialog.textContent).toContain("no space left on device");
      if (label === "Ready") expect(dialog.textContent).toContain("Gemma 4 E4B · saved as default");
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
      await user.click(within(dialog).getByRole("button", { name: "Close setup" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull());
    });
  }
}

const palettes = [
  ["Palette, all commands", "Commands"],
  ["Palette, filtered", "Commands"],
  ["Palette, Send row", "Commands"],
  ["Palette, no composer", "Commands"],
  ["Key list", "Keys"],
] as const;

for (const theme of ["slip", "kiln"]) {
  for (const [label, name] of palettes) {
    test(`the gallery's ${label} in ${theme} passes axe`, async () => {
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name });
      if (label === "Palette, filtered") expect(within(dialog).getAllByRole("option")[0]?.textContent).toContain("/model");
      if (label === "Palette, Send row") expect(within(dialog).getByRole("option").textContent).toBe('Send "explain this repo"');
      if (label === "Palette, no composer") expect(dialog.textContent).toContain("Open a session or the start page to run commands.");
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}

test("each gallery section has a stable anchor, the slip one plain and the kiln one prefixed, and no id repeats", () => {
  const { container } = render(<Gallery />);
  for (const id of ["trace", "approval", "setup-window", "setup-form", "model-dialog", "kiln-trace", "kiln-approval"]) {
    expect(container.querySelector(`#${id}`), id).toBeTruthy();
  }
  const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the gallery shows one theme when asked, and then the anchors have no prefix", async () => {
  const user = userEvent.setup();
  const { container } = render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Kiln" }));
  expect(container.querySelector('[data-theme="slip"]')).toBeNull();
  expect(container.querySelector("#trace")).toBeTruthy();
  expect(container.querySelector("#kiln-trace")).toBeNull();
});

test("the gallery has a Thinking section with streaming, done, none, and long cases", () => {
  render(<Gallery />);
  for (const label of ["streaming", "done", "no thinking", "hidden", "long thinking"]) {
    expect(screen.getAllByRole("group", { name: `Thinking, ${label}` }).length).toBeGreaterThan(0);
  }
  expect(screen.getAllByRole("button", { name: /thought for 12s/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /thinking…/ }).length).toBeGreaterThan(0);
  for (const group of screen.getAllByRole("group", { name: "Thinking, hidden" })) {
    expect(group.querySelector("[data-thinking]")).toBeNull();
    expect(group.textContent).toContain("17 * 23 = 391.");
  }
});

for (const theme of ["slip", "kiln"]) {
  for (const [label, values] of [["Tune view, a thinking model", ["", "off", "on"]], ["Tune view, thinking levels", ["", "low", "medium", "high"]]] as const) {
    test(`the gallery's "${label}" in ${theme} has a think select and passes axe`, async () => {
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
      const select = await within(dialog).findByRole("combobox", { name: "Think" });
      expect(Array.from((select as HTMLSelectElement).options).map((item) => item.value)).toEqual([...values]);
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}
