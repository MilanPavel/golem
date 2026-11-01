import { act, render, renderHook, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createPage } from "./page.ts";
import { PageProvider, useRoute, useSession, usePageActions } from "./page-context.tsx";
import { ev, fakeClient, fakeFrame } from "./test-support.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  return { fake, page, doc };
}

function Title({ id }: { id: string }) {
  const title = useSession(id, (view) => view.title);
  return <p>title: {title ?? "none"}</p>;
}

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("useSession opens on mount, follows the store, and closes after the last unmount", async () => {
  const { fake, page } = setup();
  const first = render(
    <PageProvider page={page}>
      <Title id="a" />
    </PageProvider>,
  );
  const second = render(
    <PageProvider page={page}>
      <Title id="a" />
    </PageProvider>,
  );
  await wait();
  expect(fake.raw.attachSession).toHaveBeenCalledTimes(1);
  act(() => fake.emitEvent(ev("a", "session.updated", { title: "Hello" })));
  expect(screen.getAllByText("title: Hello")).toHaveLength(2);

  first.unmount();
  await wait();
  expect(fake.raw.detachSession).not.toHaveBeenCalled();
  second.unmount();
  expect(fake.raw.detachSession).not.toHaveBeenCalled();
  await wait();
  expect(fake.raw.detachSession).toHaveBeenCalledTimes(1);
  expect(fake.raw.detachSession).toHaveBeenCalledWith("a");
  page.stop();
});

test("strict mode's remount does not detach and attach again", async () => {
  const { fake, page } = setup();
  const view = render(
    <StrictMode>
      <PageProvider page={page}>
        <Title id="a" />
      </PageProvider>
    </StrictMode>,
  );
  await wait();
  expect(fake.raw.attachSession).toHaveBeenCalledTimes(1);
  expect(fake.raw.detachSession).not.toHaveBeenCalled();
  view.unmount();
  await wait();
  expect(fake.raw.detachSession).toHaveBeenCalledTimes(1);
  page.stop();
});

test("changing the id moves the attachment", async () => {
  const { fake, page } = setup();
  const view = render(
    <PageProvider page={page}>
      <Title id="a" />
    </PageProvider>,
  );
  await wait();
  view.rerender(
    <PageProvider page={page}>
      <Title id="b" />
    </PageProvider>,
  );
  await wait();
  expect(fake.raw.attachSession.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  expect(fake.raw.detachSession.mock.calls.map((c) => c[0])).toEqual(["a"]);
  view.unmount();
  page.stop();
});

test("a selector keeps a component from rendering for other slices", async () => {
  const { fake, page } = setup();
  const renders = vi.fn();
  function Cwd() {
    const cwd = useSession("a", (view) => view.cwd);
    renders(cwd);
    return <p>cwd: {cwd ?? "none"}</p>;
  }
  render(
    <PageProvider page={page}>
      <Cwd />
    </PageProvider>,
  );
  await wait();
  const before = renders.mock.calls.length;
  act(() => fake.emitEvent(ev("a", "session.updated", { title: "T" })));
  expect(renders.mock.calls.length).toBe(before);
  page.stop();
});

test("routes, actions, and the visibility check", async () => {
  const { fake, page, doc } = setup();
  const probe = renderHook(() => ({ route: useRoute(), actions: usePageActions() }), {
    wrapper: ({ children }) => <PageProvider page={page}>{children}</PageProvider>,
  });
  expect(probe.result.current.route).toEqual({ name: "home" });
  act(() => page.router.navigate("/s/x"));
  expect(probe.result.current.route).toEqual({ name: "session", id: "x" });
  const { actions } = probe.result.current;

  await expect(actions.createSession("/repo")).resolves.toBe("s_new");
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: "/repo" });
  await actions.createSession(null);
  expect(fake.raw.createSession).toHaveBeenLastCalledWith(undefined);
  await actions.send("s", "hi");
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("s", "hi");
  await actions.cancel("r");
  expect(fake.raw.cancelRun).toHaveBeenCalledWith("r");

  (doc as { visibilityState: string }).visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(fake.raw.checkNow).not.toHaveBeenCalled();
  (doc as { visibilityState: string }).visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(fake.raw.checkNow).toHaveBeenCalledTimes(1);
  page.stop();
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(fake.raw.checkNow).toHaveBeenCalledTimes(1);
});
