import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { DRAWER_KEY, drawerOpenStore, readDrawerOpen } from "../drawer/drawer-open.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

type Todo = { id: string; text: string; status: "pending" | "in_progress" | "done" };
const TODOS: Todo[] = [
  { id: "1", text: "Find the decoder", status: "done" },
  { id: "2", text: "Decode with a streaming TextDecoder", status: "in_progress" },
  { id: "3", text: "Run the client tests", status: "pending" },
];

function setup() {
  history.replaceState(null, "", "/s/a");
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
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split" });
  });
  return { fake, ...view };
}

async function open() {
  const view = setup();
  await wait();
  act(() => {
    view.fake.emitEvent(ev("a", "session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "m" }));
  });
  return view;
}

const sendTodos = (fake: ReturnType<typeof fakeClient>, todos: Todo[] = TODOS) =>
  act(() => {
    fake.emitEvent(ev("a", "todos.updated", { call_id: "c1", todos }));
  });

const toggle = () => within(screen.getByRole("banner")).getByRole("button", { name: /^(Show|Hide) details$/ });
const drawer = () => screen.queryByRole("complementary", { name: "Details" });

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("the toggle names the drawer and hides and shows it", async () => {
  const user = userEvent.setup();
  await open();
  const button = within(screen.getByRole("banner")).getByRole("button", { name: "Hide details" });
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-controls")).toBe(drawer()?.id);
  await user.click(button);
  expect(drawer()).toBeNull();
  const shown = within(screen.getByRole("banner")).getByRole("button", { name: "Show details" });
  expect(shown.getAttribute("aria-expanded")).toBe("false");
  await user.click(shown);
  expect(drawer()).toBeTruthy();
  expect(localStorage.getItem(DRAWER_KEY)).toBe("open");
});

test("the choice survives a remount and a new page built from the same storage", async () => {
  const user = userEvent.setup();
  const first = await open();
  await user.click(toggle());
  first.unmount();
  const second = await open();
  expect(drawer()).toBeNull();
  second.unmount();
  drawerOpenStore.set(readDrawerOpen());
  await open();
  expect(drawer()).toBeNull();
  expect(localStorage.getItem(DRAWER_KEY)).toBe("closed");
});

test("Escape inside the drawer closes it, and focus goes back to the toggle", async () => {
  const user = userEvent.setup();
  await open();
  within(drawer() as HTMLElement).getByRole("button", { name: "Hide details" }).focus();
  await user.keyboard("{Escape}");
  expect(drawer()).toBeNull();
  expect(document.activeElement).toBe(toggle());
});

test("a todos.updated event shows in the drawer, and the closed toggle shows the count", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  expect(within(drawer() as HTMLElement).getByText(/No todos yet/)).toBeTruthy();
  sendTodos(fake);
  const list = within(drawer() as HTMLElement).getByRole("list", { name: "Todos" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(within(drawer() as HTMLElement).getByText("1 of 3")).toBeTruthy();
  await user.click(toggle());
  const closed = toggle();
  expect(closed.getAttribute("aria-label")).toBe("Show details");
  expect(closed.textContent).toBe("1/3");
  expect(closed.getAttribute("title")).toBe("1 of 3 todos done");
  sendTodos(fake, TODOS.map((todo) => (todo.id === "2" ? { ...todo, status: "done" } : todo)));
  expect(toggle().textContent).toBe("2/3");
});

test("the closed toggle shows no count without todos", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(toggle());
  expect(toggle().textContent).toBe("");
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the drawer with todos has no accessibility violations in ${theme}`, async () => {
    const { fake, container } = await open();
    sendTodos(fake);
    document.documentElement.dataset.theme = theme;
    try {
      expect((await axe.run(container, noContrast)).violations).toEqual([]);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
}

test("the chat shows the View tabs at every width, with Chat current", async () => {
  await open();
  const nav = screen.getByRole("navigation", { name: "View" });
  expect(within(nav).getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("link", { name: "Trace" }).hasAttribute("aria-current")).toBe(false);
  expect(nav.className).not.toContain("max-narrow:hidden");
  expect((nav.parentElement as HTMLElement).className).not.toContain("max-narrow:hidden");
});

test("the chat has no accessibility violations", async () => {
  const { container } = await open();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the chat shows ctx after a model call, and the chip opens the trace on that call", async () => {
  const { fake, container } = await open();
  act(() => {
    fake.emitEvent(ev("a", "model.call.started", { message_id: "m_1", index: 1, profile: "default", context_window: 128000 }));
    fake.emitEvent(ev("a", "model.call.completed", { message_id: "m_1", latency_ms: 900, usage: { input: 32000, output: 10 } }));
  });
  const chip = screen.getByRole("button", { name: /^Context 32\.0K \/ 128K · 25%/ });
  expect(chip.textContent).toBe("ctx 25%");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await userEvent.setup().click(chip);
  expect(location.pathname).toBe("/s/a/trace");
  expect(location.search).toBe("?span=m_1");
});
