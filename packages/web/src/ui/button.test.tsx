import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Button } from "./button.tsx";
import { IconButton } from "./icon-button.tsx";
import { PlusIcon } from "./icons.tsx";

test("a button activates on Enter and on Space", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Save</Button>);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  expect(onClick).toHaveBeenCalledTimes(2);
});

test("a disabled button is skipped by the keyboard and does not fire", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<Button disabled onClick={onClick}>Save</Button>);
  await user.tab();
  await user.keyboard("{Enter}");
  expect(onClick).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.body);
});

test("a button is type=button unless told otherwise", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button").getAttribute("type")).toBe("button");
});

test("an icon button is named by its label and shows it as a tooltip on focus", async () => {
  const user = userEvent.setup();
  render(
    <IconButton label="New session">
      <PlusIcon />
    </IconButton>,
  );
  const button = screen.getByRole("button", { name: "New session" });
  await user.tab();
  expect(document.activeElement).toBe(button);
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  expect((await screen.findByRole("tooltip")).textContent).toBe("New session");
});

test("an icon button requires a label", () => {
  // @ts-expect-error label is required
  const bad = <IconButton><PlusIcon /></IconButton>;
  expect(bad).toBeTruthy();
});
