import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
import { SETUP_CASES } from "../features/setup/sample.ts";
import { Gallery } from "./gallery.tsx";

test("the gallery shows both themes and has no accessibility violations", async () => {
  const { container } = render(<Gallery />);
  expect(container.querySelector('[data-theme="slip"]')).toBeTruthy();
  expect(container.querySelector('[data-theme="kiln"]')).toBeTruthy();
  const results = await axe.run(container, {
    // jsdom does not compute colors, so contrast cannot be checked here.
    // tokens.test.ts checks every text and background pair in both themes.
    rules: { "color-contrast": { enabled: false } },
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
