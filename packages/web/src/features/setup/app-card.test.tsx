import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AppCard } from "./app-card.tsx";

const HOST = "127.0.0.1:7480";
const BODY = "Install this page as an app. It opens in its own window from the Dock, and stays signed in.";

test("Chrome with a saved prompt: the button fires it, and the bookmark line follows", async () => {
  const onInstall = vi.fn();
  render(<AppCard offer="prompt" host={HOST} where="ready" onInstall={onInstall} />);
  expect(screen.getByText("Keep golem one click away")).toBeTruthy();
  expect(screen.getByText(BODY)).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Install golem as an app" }));
  expect(onInstall).toHaveBeenCalledTimes(1);
  expect(screen.getByText(HOST)).toBeTruthy();
  expect(screen.getByText(/or bookmark/)).toBeTruthy();
});

test("Safari: the menu hint takes the place of the button", () => {
  render(<AppCard offer="safari" host={HOST} where="ready" onInstall={() => undefined} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("File → Add to Dock…")).toBeTruthy();
  expect(screen.getByText(HOST)).toBeTruthy();
});

test("another browser: only the bookmark line", () => {
  render(<AppCard offer="other" host={HOST} where="ready" onInstall={() => undefined} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(/Add to Dock/)).toBeNull();
  expect(screen.getByText(/Bookmark/)).toBeTruthy();
  expect(screen.getByText(HOST)).toBeTruthy();
});

test("installed: says so and offers nothing more", () => {
  render(<AppCard offer="installed" host={HOST} where="ready" onInstall={() => undefined} />);
  expect(screen.getByText("Installed. Open golem from the Dock.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("no offer draws nothing", () => {
  const { container } = render(<AppCard offer={null} host={HOST} where="ready" onInstall={() => undefined} />);
  expect(container.innerHTML).toBe("");
});

test("in Settings the block has the App heading", () => {
  render(<AppCard offer="prompt" host={HOST} where="settings" onInstall={() => undefined} />);
  expect(screen.getByRole("heading", { level: 3, name: "App" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Install golem as an app" })).toBeTruthy();
});
