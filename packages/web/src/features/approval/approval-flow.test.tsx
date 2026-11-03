import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { Transcript } from "../chat/transcript.tsx";
import { diffModeStore } from "../diff/diff-mode.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <Transcript id="s1" />
    </PageProvider>,
  );
  const send = (type: Parameters<typeof ev>[1], data: Record<string, unknown>) => {
    act(() => {
      fake.emitEvent(ev("s1", type, data));
    });
  };
  return { fake, page, send };
}

function ask(send: ReturnType<typeof setup>["send"]) {
  send("run.started", {});
  send("message.started", { message_id: "m1", role: "assistant" });
  send("message.completed", { message_id: "m1", role: "assistant", text: "Editing." });
  send("tool.requested", { call_id: "c1", message_id: "m1", name: "edit_file", args: { path: "src/a.ts" } });
  send("approval.needed", {
    call_id: "c1",
    name: "edit_file",
    args: { path: "src/a.ts" },
    source: "built-in default",
    subject: "src/a.ts",
    diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
  });
}

beforeEach(() => {
  diffModeStore.set("unified");
});
afterEach(() => {
  history.replaceState(null, "", "/");
});

test("an approval shows the pending card, and Allow once answers the call", async () => {
  const { fake, send } = setup();
  await wait();
  ask(send);
  expect(screen.getByRole("group", { name: "Approval" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Allow once/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenCalledWith("s1", "c1", "allow");
});

test("an answer from elsewhere collapses the card and clears waiting", async () => {
  const { send } = setup();
  await wait();
  ask(send);
  expect(document.body.textContent).toContain("waiting for you");
  send("approval.resolved", { call_id: "c1", name: "edit_file", decision: "allow_session", subject: "src/a.ts" });
  expect(screen.getByRole("group", { name: "Approval" }).textContent).toContain("✓ Allowed for this session");
  expect(screen.queryByRole("button", { name: /^Allow once/ })).toBeNull();
  expect(document.body.textContent).not.toContain("waiting for you");
});

test("a denied call reads denied on the tool line", async () => {
  const { send } = setup();
  await wait();
  ask(send);
  send("approval.resolved", { call_id: "c1", name: "edit_file", decision: "deny" });
  send("tool.failed", { call_id: "c1", message: "the user denied this tool call" });
  expect(screen.getByRole("group", { name: "Approval" }).textContent).toContain("✗ Denied");
  const line = document.querySelector("[data-tool-status=failed]");
  expect(line?.textContent).toContain("✗ denied");
  expect(line?.textContent).not.toContain("the user denied");
});

test("a key answers the call, and a failed send shows its error", async () => {
  const { fake, send } = setup();
  await wait();
  fake.raw.respondApproval.mockRejectedValueOnce(new Error("no such call"));
  ask(send);
  fireEvent.keyDown(document.body, { key: "d" });
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenCalledWith("s1", "c1", "deny");
  expect(screen.getByRole("alert").textContent).toBe("no such call");
});
