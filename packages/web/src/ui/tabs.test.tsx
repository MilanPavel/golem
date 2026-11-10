import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.tsx";

function Demo() {
  return (
    <Tabs defaultValue="one">
      <TabsList aria-label="Parts">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">first</TabsContent>
      <TabsContent value="two">second</TabsContent>
    </Tabs>
  );
}

test("the tabs follow the ARIA tabs pattern", () => {
  render(<Demo />);
  expect(screen.getByRole("tablist", { name: "Parts" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Two" }).getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("tabpanel").textContent).toBe("first");
});

test("a click switches the tab", async () => {
  const user = userEvent.setup();
  render(<Demo />);
  await user.click(screen.getByRole("tab", { name: "Two" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("second");
});

test("the arrow keys move between the tabs and wrap", async () => {
  const user = userEvent.setup();
  render(<Demo />);
  screen.getByRole("tab", { name: "One" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Two" }).getAttribute("aria-selected")).toBe("true");
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
});
