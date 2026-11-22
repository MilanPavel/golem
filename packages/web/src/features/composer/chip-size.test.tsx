import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ContextChipView } from "./context-chip.tsx";
import { FolderBarBadge } from "./folder-bar-chip.tsx";
import { ModeChipView } from "./mode-chip.tsx";

test("the chips of the composer's row share one height", () => {
  render(
    <>
      <ModeChipView own="balanced" fallback="balanced" onSelect={() => {}} />
      <ContextChipView used={32000} window={128000} onOpen={() => {}} />
      <FolderBarBadge folder="/Users/you/repos/golem" />
    </>,
  );
  const chips = [screen.getByRole("button", { name: /Permission mode/ }), screen.getByRole("button", { name: /^Context / }), screen.getByTitle("/Users/you/repos/golem")];
  for (const chip of chips) {
    expect(chip.className).toContain("h-7.5");
  }
});

test("an icon-only chip keeps its text for screen readers and its full name as the title", () => {
  render(
    <>
      <ModeChipView own="autopilot" fallback="balanced" onSelect={() => {}} />
      <FolderBarBadge folder="/Users/you/repos/golem" />
    </>,
  );
  const mode = screen.getByRole("button", { name: /Permission mode/ });
  expect(mode.textContent).toBe("Autopilot");
  expect(mode.querySelector("span")?.className).toContain("@max-row-500/comp:sr-only");
  expect(mode.getAttribute("title")).toContain("Autopilot.");
  const folder = screen.getByTitle("/Users/you/repos/golem");
  expect(folder.textContent).toBe("golem");
  expect(folder.querySelector("span")?.className).toContain("@max-row-400/comp:sr-only");
});
