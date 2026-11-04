import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
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
