import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Button } from "./button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

test("a dialog opens from its trigger, traps focus, and Escape returns focus to the trigger", async () => {
  const user = userEvent.setup();
  render(
    <>
      <Button>Before</Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
          <DialogClose asChild>
            <Button>One</Button>
          </DialogClose>
          <Button>Two</Button>
        </DialogContent>
      </Dialog>
      <Button>After</Button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Title" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  for (let i = 0; i < 5; i += 1) {
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("a popover opens from its trigger, keeps focus inside, and Escape returns focus", async () => {
  const user = userEvent.setup();
  render(
    <Popover>
      <PopoverTrigger asChild>
        <Button>Open</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Button>Inside</Button>
      </PopoverContent>
    </Popover>,
  );
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  await user.keyboard(" ");
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test.each([["{Enter}"], ["{ArrowDown}"]])("a menu opens with %s, arrows move, Enter selects, Escape closes", async (key) => {
  const user = userEvent.setup();
  const onFork = vi.fn();
  render(
    <Menu>
      <MenuTrigger asChild>
        <Button>Open</Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>Rename</MenuItem>
        <MenuItem onSelect={onFork}>Fork</MenuItem>
        <MenuSeparator />
        <MenuItem>Delete</MenuItem>
      </MenuContent>
    </Menu>,
  );
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  await user.keyboard(key);
  await screen.findByRole("menu");
  // Opened from the keyboard, focus lands on the first item.
  const first = screen.getByRole("menuitem", { name: "Rename" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Fork" }));
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(first);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onFork).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  await user.keyboard("{Enter}");
  await screen.findByRole("menu");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("a tooltip appears when its trigger gets focus and goes on Escape", async () => {
  const user = userEvent.setup();
  render(
    <Tooltip>
      <TooltipTrigger asChild>
        <Button>Hint</Button>
      </TooltipTrigger>
      <TooltipContent>Says more</TooltipContent>
    </Tooltip>,
  );
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("Says more");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});
