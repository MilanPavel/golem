import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ContextChipView } from "./context-chip.tsx";
import { ModeChipView } from "./mode-chip.tsx";
import { TuneChipView } from "./tune-chip.tsx";

const paddingOf = (element: HTMLElement) => element.className.split(/\s+/).filter((token) => /^py-/.test(token));

test("the three composer chips share one vertical padding", () => {
  render(
    <>
      <ModeChipView own="balanced" fallback="balanced" onSelect={() => {}} />
      <ContextChipView used={32000} window={128000} onOpen={() => {}} />
      <TuneChipView text="temp 0.2" onOpen={() => {}} />
    </>,
  );
  const mode = screen.getByRole("button", { name: /Permission mode/ });
  const context = screen.getByRole("button", { name: /^Context / });
  const tune = screen.getByRole("button", { name: /Changed options/ });

  expect(paddingOf(mode)).toEqual(["py-1"]);
  expect(paddingOf(context)).toEqual(["py-1"]);
  expect(paddingOf(tune)).toEqual(["py-1"]);
});
