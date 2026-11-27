import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

const panelOf = (label: string) => within(screen.getByRole("complementary", { name: `Sessions, ${label}, slip` }));

test("the gallery's helper section: the open lead has its helpers nested, working and finished", () => {
  showTheme("slip");
  render(<Gallery only="helpers-in-the-list" />);
  const working = panelOf("lead open, helpers working");
  // Three leads and the two helpers of the open one.
  expect(working.getAllByRole("link")).toHaveLength(5);
  expect(working.getAllByRole("link")[0]!.querySelector("[data-square]")).toBeNull();
  expect(document.querySelectorAll("[data-helper-row=working]").length).toBeGreaterThanOrEqual(2);
  const finished = panelOf("lead open, helpers finished");
  expect(finished.getAllByRole("link")).toHaveLength(5);
  expect(finished.getAllByRole("link", { name: /explorer · ADR/ })).toHaveLength(2);
});

test("the gallery's helper section: another chat open keeps the squares, and a fork has its tag", () => {
  showTheme("slip");
  render(<Gallery only="helpers-in-the-list" />);
  const other = panelOf("another chat open: squares only");
  expect(other.getAllByRole("link")).toHaveLength(3);
  expect(other.getByRole("link", { name: /Map the daemon modules/ }).querySelectorAll("[data-square=working]")).toHaveLength(2);
  expect(other.getByRole("link", { name: /Check the retry code/ }).querySelectorAll("[data-square=asking]")).toHaveLength(1);
  expect(other.getByRole("link", { name: /Read the ADRs/ }).querySelector("[data-square]")).toBeNull();
  const fork = panelOf("a fork next to helpers");
  expect(fork.getAllByTestId("fork-tag")).toHaveLength(1);
  expect(fork.getAllByRole("link")).toHaveLength(3);
});

test("the gallery's helper card shows two working, one asking, one queued", () => {
  showTheme("slip");
  render(<Gallery only="helper-card" />);
  const group = within(screen.getByRole("group", { name: "Helpers of Map the daemon modules, slip" }));
  expect(group.getByText("4 helpers · 1 asks you")).toBeTruthy();
  const states = [...document.querySelectorAll("[data-helper-block]")].map((block) => block.getAttribute("data-helper-block"));
  expect(states).toEqual(["working", "working", "asking", "queued"]);
  expect(group.getByRole("button", { name: "Stop explorer routing" })).toBeTruthy();
});
