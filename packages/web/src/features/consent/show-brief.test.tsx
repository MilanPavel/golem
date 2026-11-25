import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { DockedConsent } from "./docked-consent.tsx";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <DockedConsent sessionId="s1" />
    </PageProvider>,
  );
  const send = (data: Record<string, unknown>) => {
    act(() => {
      fake.emitEvent(ev("s1", "route.consent.needed", data));
    });
  };
  return { fake, send };
}

const ASKED = {
  model_profile: "deepseek/deepseek-chat",
  provider: "deepseek",
  model: "deepseek-chat",
  tier: "budget",
  why: "The brief needs a bigger window.",
  estimated_usd: 0.0213,
  alternatives: ["once", "local"],
  helper_id: "h1",
  agent: "reviewer",
  label: "the diff",
  sent: ["the brief", "the diff, 3 lines"],
  not_sent: ["this chat"],
};

const DIFF = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old line\n+new line\n";

test("a question without a brief or diff has no Show", async () => {
  const { send } = setup();
  await wait();
  send(ASKED);
  expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
});

test("Show reveals the brief, collapsed by default, and a reviewer's local answer reads Review locally", async () => {
  const { send } = setup();
  await wait();
  send({ ...ASKED, brief: "Check the diff for races.\nReturn findings." });
  expect(screen.queryByLabelText("The brief")).toBeNull();
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Show", "Just this once", "Review locally"]);
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(screen.getByLabelText("The brief").textContent).toBe("Check the diff for races.\nReturn findings.");
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(screen.queryByLabelText("The brief")).toBeNull();
});

test("another helper keeps Stay local", async () => {
  const { send } = setup();
  await wait();
  send({ ...ASKED, agent: "worker", brief: "Do it." });
  expect(screen.getByRole("button", { name: "Stay local" })).toBeTruthy();
});

test("the diff is read once, when Show opens, and drawn as a diff", async () => {
  const { fake, send } = setup();
  await wait();
  fake.raw.readArtifact.mockResolvedValue({ text: DIFF, offset: 0, size: DIFF.length });
  send({ ...ASKED, brief: "Check it.", diff_artifact_id: "a1" });
  expect(fake.raw.readArtifact).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(document.querySelector("[data-brief-diff=loading]")).not.toBeNull();
  await wait();
  expect(fake.raw.readArtifact).toHaveBeenCalledTimes(1);
  expect(fake.raw.readArtifact.mock.calls[0]?.slice(0, 2)).toEqual(["s1", "a1"]);
  expect(document.querySelector("[data-brief-diff=ready]")?.textContent).toContain("new line");
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await wait();
  expect(fake.raw.readArtifact).toHaveBeenCalledTimes(1);
});

test("a diff that cannot be read says so", async () => {
  const { fake, send } = setup();
  await wait();
  fake.raw.readArtifact.mockRejectedValue(new Error("gone"));
  send({ ...ASKED, diff_artifact_id: "a1" });
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await wait();
  expect(screen.getByRole("alert").textContent).toContain("could not be read");
});
