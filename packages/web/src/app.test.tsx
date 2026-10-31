import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { expect, test } from "vitest";
import { App } from "./app.tsx";

test("the page has a heading and no accessibility violations", async () => {
  const { container } = render(<App />);
  expect(screen.getByRole("heading", { name: "golem" })).toBeTruthy();
  const results = await axe.run(container, {
    // jsdom does not compute colors, so contrast cannot be checked here.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
