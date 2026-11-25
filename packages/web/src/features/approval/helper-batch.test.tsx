import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { DockedApproval } from "./docked-approval.tsx";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

afterEach(() => {
  history.replaceState(null, "", "/");
});

const SINGLE = { agent: "explorer", brief: "List every call site of httpx." };
const MANY = {
  batch: [
    { agent: "explorer", brief: "Call sites", label: "call sites" },
    { agent: "explorer", brief: "The changelog", label: "changelog" },
    { agent: "worker", brief: "Upgrade httpx", label: "upgrade" },
  ],
};

async function setup(args: Record<string, unknown>, source = "use_helpers", extra: Record<string, unknown> = {}) {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  fake.raw.attachSession.mockImplementation(async () => {
    const send = (type: Parameters<typeof ev>[1], data: Record<string, unknown>) => {
      fake.emitEvent(ev("s1", type, data));
    };
    send("run.started", {});
    send("message.started", { message_id: "m1", role: "assistant" });
    send("message.completed", { message_id: "m1", role: "assistant", text: "" });
    send("tool.requested", { call_id: "c1", message_id: "m1", name: "delegate", args });
    send("approval.needed", { call_id: "c1", name: "delegate", args, source, ...extra });
    return {} as never;
  });
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  const view = render(
    <PageProvider page={page}>
      <DockedApproval sessionId="s1" />
      <textarea aria-label="Message" />
    </PageProvider>,
  );
  await wait();
  return { fake, user: userEvent.setup(), ...view };
}

test("one helper: the head, the brief, Run and Do it in the chat, and no session choices", async () => {
  await setup(SINGLE);
  const card = screen.getByRole("group", { name: "Start helpers" });
  expect(card.id).toBe("approval-c1");
  expect(within(card).getByText("1 helper · explorer")).toBeTruthy();
  expect(within(card).getByText("List every call site of httpx.")).toBeTruthy();
  expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Run↵", "Do it in the chat"]);
  expect(screen.queryByRole("group", { name: "Approval" })).toBeNull();
  expect(screen.queryByText(/this chat|session|Always/i)).toBeNull();
});

test("a batch of three lists each job", async () => {
  await setup(MANY);
  const card = screen.getByRole("group", { name: "Start helpers" });
  expect(within(card).getByText("3 helpers · explorer ×2, worker")).toBeTruthy();
  expect(card.querySelectorAll("[data-helper-job]")).toHaveLength(3);
  expect(within(card).getByText("explorer · changelog")).toBeTruthy();
});

test("Run answers helpers.respond with run true", async () => {
  const { fake, user } = await setup(SINGLE);
  await user.click(screen.getByRole("button", { name: /^Run/ }));
  expect(fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", true);
  expect(fake.raw.respondApproval).not.toHaveBeenCalled();
});

test("Do it in the chat answers with run false", async () => {
  const { fake, user } = await setup(SINGLE);
  await user.click(screen.getByRole("button", { name: "Do it in the chat" }));
  expect(fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", false);
});

test("Enter runs; S, W, D and E do nothing", async () => {
  const { fake } = await setup(SINGLE);
  for (const key of ["s", "w", "d", "e"]) fireEvent.keyDown(document.body, { key });
  expect(fake.raw.respondHelpers).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", true);
});

test("a key is left alone while a message is being typed", async () => {
  const { fake, user } = await setup(SINGLE);
  await user.click(screen.getByRole("textbox", { name: "Message" }));
  await user.keyboard("{Enter}");
  expect(fake.raw.respondHelpers).not.toHaveBeenCalled();
});

test("a failed answer leaves a line on the card and allows another try", async () => {
  const { fake, user } = await setup(SINGLE);
  fake.raw.respondHelpers.mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("button", { name: /^Run/ }));
  expect((await screen.findByRole("alert")).textContent).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Run/ }));
  expect(fake.raw.respondHelpers).toHaveBeenCalledTimes(2);
});

test("another source for delegate keeps the ordinary approval bar", async () => {
  const { fake } = await setup(SINGLE, "built-in default");
  expect(screen.getByRole("group", { name: "Approval" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Start helpers" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(fake.raw.respondApproval).toHaveBeenCalledWith("s1", "c1", "allow");
  expect(fake.raw.respondHelpers).not.toHaveBeenCalled();
});

test("the card passes axe", async () => {
  const { container } = await setup(MANY);
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});

const ESTIMATE = { estimate_usd: 0.6, allowed_usd: 2, ask_over_usd: 0.5, model: "claude-sonnet", cheaper_model: "claude-haiku" };

test("an estimate: the line, the model in the head and three answers", async () => {
  await setup(SINGLE, "use_helpers", ESTIMATE);
  const card = screen.getByRole("group", { name: "Start helpers" });
  expect(within(card).getByText("1 helper · explorer · claude-sonnet")).toBeTruthy();
  expect(within(card).getByText("About $0.60 of the $2.00 you allow per message.")).toBeTruthy();
  expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Start↵", "Use a cheaper model", "Do it in the chat"]);
});

test("Start, Use a cheaper model and Do it in the chat send the right params", async () => {
  const start = await setup(SINGLE, "use_helpers", ESTIMATE);
  await start.user.click(screen.getByRole("button", { name: /^Start/ }));
  expect(start.fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", true);
  start.unmount();
  const cheaper = await setup(SINGLE, "use_helpers", ESTIMATE);
  await cheaper.user.click(screen.getByRole("button", { name: "Use a cheaper model" }));
  expect(cheaper.fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", true, true);
  cheaper.unmount();
  const chat = await setup(SINGLE, "use_helpers", ESTIMATE);
  await chat.user.click(screen.getByRole("button", { name: "Do it in the chat" }));
  expect(chat.fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", false);
});

test("without a cheaper model the card has two answers; Enter still starts", async () => {
  const { fake } = await setup(SINGLE, "use_helpers", { ...ESTIMATE, cheaper_model: null });
  expect(screen.queryByRole("button", { name: "Use a cheaper model" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(fake.raw.respondHelpers).toHaveBeenCalledExactlyOnceWith("s1", "c1", true);
});

test("a batch without an estimate reads as before: Run, no line", async () => {
  await setup(SINGLE);
  expect(document.querySelector("[data-helper-estimate]")).toBeNull();
  expect(screen.queryByRole("button", { name: "Use a cheaper model" })).toBeNull();
});
