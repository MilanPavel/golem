import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { detailStore } from "./detail.ts";
import { DetailSwitch } from "./detail-switch.tsx";

afterEach(() => {
  localStorage.clear();
  detailStore.set("normal");
});

test("the switch is a radio group named Chat detail with Normal checked, and a click sets and keeps the level", () => {
  render(<DetailSwitch />);
  const group = screen.getByRole("radiogroup", { name: "Chat detail" });
  expect(group).toBeTruthy();
  expect(screen.getAllByRole("radio").map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([
    ["Quiet", "false"],
    ["Normal", "true"],
    ["Verbose", "false"],
  ]);
  fireEvent.click(screen.getByRole("radio", { name: "Verbose" }));
  expect(screen.getByRole("radio", { name: "Verbose" }).getAttribute("aria-checked")).toBe("true");
  expect(localStorage.getItem("golem.detail")).toBe("verbose");
});

test("the arrow keys move the choice, and the group passes axe", async () => {
  const { container } = render(<DetailSwitch />);
  fireEvent.keyDown(screen.getByRole("radio", { name: "Normal" }), { key: "ArrowRight" });
  expect(detailStore.getSnapshot()).toBe("verbose");
  fireEvent.keyDown(screen.getByRole("radio", { name: "Verbose" }), { key: "ArrowRight" });
  expect(detailStore.getSnapshot()).toBe("quiet");
  expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
});
