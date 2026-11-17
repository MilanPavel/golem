import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { DockedApproval } from "./docked-approval.tsx";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("attaching to a waiting headless session shows its approval from the replay", async () => {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  // The daemon replays the stored events as the attach is answered.
  fake.raw.attachSession.mockImplementation(async () => {
    const send = (type: Parameters<typeof ev>[1], data: Record<string, unknown>) => {
      fake.emitEvent(ev("s1", type, data));
    };
    send("run.started", {});
    send("message.started", { message_id: "m1", role: "assistant" });
    send("message.completed", { message_id: "m1", role: "assistant", text: "" });
    send("tool.requested", { call_id: "c1", message_id: "m1", name: "edit_file", args: { path: "src/a.ts" } });
    send("approval.needed", {
      call_id: "c1",
      name: "edit_file",
      args: { path: "src/a.ts" },
      source: "built-in default",
      subject: "src/a.ts",
    });
    return {} as never;
  });
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <DockedApproval sessionId="s1" />
    </PageProvider>,
  );
  await wait();
  expect(screen.getByRole("group", { name: "Approval" }).id).toBe("approval-c1");
});
