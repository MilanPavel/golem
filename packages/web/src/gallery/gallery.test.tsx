import { render } from "@testing-library/react";
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
