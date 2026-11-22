import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ContextChipView } from "./context-chip.tsx";

test("an exact window shows a ring, the tokens and the window, and the percent for a narrow composer", () => {
  render(<ContextChipView used={32000} window={128000} onOpen={() => {}} />);
  const chip = screen.getByRole("button");
  expect(chip.textContent).toBe("32.0K / 128K25%");
  expect(chip.querySelector("svg circle:nth-of-type(2)")).toBeTruthy();
  expect(chip.getAttribute("title")).not.toContain("not sent");
});

test("under 600 px the window goes, and under 500 px the percent takes the place of the tokens", () => {
  render(<ContextChipView used={32000} window={128000} onOpen={() => {}} />);
  const chip = screen.getByRole("button");
  expect(chip.textContent).toContain(" / 128K");
  expect(chip.innerHTML).toContain("@max-row-600/comp:hidden");
  expect(chip.innerHTML).toContain("@max-row-500/comp:hidden");
  expect(chip.innerHTML).toContain("@max-row-500/comp:inline");
});

test("an estimated window shows ≈ and says why on hover", () => {
  const onOpen = vi.fn();
  render(<ContextChipView used={1300} window={16384} windowEstimated onOpen={onOpen} />);
  const chip = screen.getByRole("button");
  expect(chip.textContent).toContain("≈7%");
  expect(chip.getAttribute("title")).toContain("golem read this window from Ollama. It was not sent.");
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalled();
});

test("an unknown window shows the tokens only", () => {
  render(<ContextChipView used={1300} window={null} onOpen={() => {}} />);
  expect(screen.getByRole("button").textContent).toBe("1.3K");
});

test("after a clear the chip says how many results were cleared", () => {
  render(<ContextChipView used={38000} window={100000} cleared={12} onOpen={() => {}} />);
  expect(screen.getByRole("button").textContent).toContain("· 12 cleared");
});
