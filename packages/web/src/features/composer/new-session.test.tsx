import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, INVALID_PARAMS_CODE, rpcError, summary } from "../../store/test-support.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup() {
  history.replaceState(null, "", "/");
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", "/Users/you/repos/golem")));
  return { fake, page, ...view, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  history.replaceState(null, "", "/");
});

test("the large composer has focus on mount and no accessibility violations", async () => {
  const { container } = setup();
  expect(document.activeElement).toBe(box());
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("sending creates the session in the chosen folder, sends, and opens it", async () => {
  const { fake, user } = setup();
  await user.type(box(), "explain this repo{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: "/Users/you/repos/golem" });
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_new", "explain this repo");
  expect(location.pathname).toBe("/s/s_new");
});

test("an invalid folder is shown under the chip and the text is kept", async () => {
  const { fake, user } = setup();
  fake.raw.createSession.mockRejectedValueOnce(rpcError(INVALID_PARAMS_CODE, "cwd must be an absolute path"));
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(screen.getByRole("alert").textContent).toBe("cwd must be an absolute path");
  expect(box().value).toBe("hello");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/");
});

test("any other error is shown under the composer, the text is kept, and a retry reuses the new session", async () => {
  const { fake, user } = setup();
  fake.raw.sendMessage.mockRejectedValueOnce(new Error("socket closed"));
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(screen.getByRole("alert").textContent).toBe("socket closed");
  expect(box().value).toBe("hello");
  expect(location.pathname).toBe("/");
  await user.click(box());
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledTimes(1);
  expect(fake.raw.sendMessage).toHaveBeenCalledTimes(2);
  expect(location.pathname).toBe("/s/s_new");
});

test("a send with no model goes to /welcome?from=send and nothing opens as a dialog", async () => {
  const { fake, user } = setup();
  fake.raw.sendMessage.mockRejectedValueOnce(rpcError(-32005, "no model chosen yet"));
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(location.pathname + location.search).toBe("/welcome?from=send");
  expect(fake.raw.sendMessage).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
});

test("/setup opens Settings → Setup", async () => {
  const { user } = setup();
  await user.type(box(), "/setup{Enter}");
  await wait();
  expect(location.pathname).toBe("/settings");
  expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
});
