import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { Transcript } from "../chat/transcript.tsx";
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
      <Transcript id="s1" />
      <div data-testid="dock">
        <DockedConsent sessionId="s1" />
      </div>
    </PageProvider>,
  );
  const send = (type: Parameters<typeof ev>[1], data: Record<string, unknown>) => {
    act(() => {
      fake.emitEvent(ev("s1", type, data));
    });
  };
  return { fake, send };
}

const ASKED = {
  model_profile: "deepseek/deepseek-chat",
  provider: "deepseek",
  model: "deepseek-chat",
  tier: "budget",
  why: "This turn does not fit qwen3.8:27b's 32K window, even after clearing old results.",
  estimated_usd: 0.0213,
  alternatives: ["session", "once", "local"],
  caps: { session_usd: 0.5, daily_usd: 2.0, spent_session: 0.1, spent_today: 0.42 },
};

test("the question docks above the composer with its texts and three buttons", async () => {
  const { send } = setup();
  await wait();
  send("run.started", {});
  send("route.consent.needed", ASKED);
  const card = screen.getByRole("group", { name: "Paid model" });
  expect(screen.getByTestId("dock").contains(card)).toBe(true);
  expect(card.textContent).toContain("Use a paid model for this?");
  expect(card.textContent).toContain("even after clearing old results.");
  expect(card.querySelector("[data-consent-line]")?.textContent).toBe("deepseek-chat · budget · ≈ $0.02 for this turn");
  expect(card.textContent).toContain("Session cap $0.50 · today $0.42 of $2.00");
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Allow for this session",
    "Just this once",
    "Stay local",
  ]);
});

test("a button answers the run, once", async () => {
  const { fake, send } = setup();
  await wait();
  send("route.consent.needed", ASKED);
  fireEvent.click(screen.getByRole("button", { name: "Just this once" }));
  fireEvent.click(screen.getByRole("button", { name: "Just this once" }));
  await wait();
  expect(fake.raw.answerConsent).toHaveBeenCalledTimes(1);
  expect(fake.raw.answerConsent).toHaveBeenCalledWith("s1", "r1", "once");
});

test("an answer from another client takes the card away", async () => {
  const { send } = setup();
  await wait();
  send("route.consent.needed", ASKED);
  expect(screen.getByRole("group", { name: "Paid model" })).toBeTruthy();
  send("route.consent.answered", { answer: "local" });
  expect(screen.queryByRole("group", { name: "Paid model" })).toBeNull();
});

test("a spent cap offers only once and local, and a failed answer shows its error", async () => {
  const { fake, send } = setup();
  await wait();
  fake.raw.answerConsent.mockRejectedValueOnce(new Error("no run waits on this question"));
  send("route.consent.needed", { ...ASKED, why: "The daily budget ($2.00) is spent.", alternatives: ["once", "local"] });
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Just this once", "Stay local"]);
  fireEvent.click(screen.getByRole("button", { name: "Stay local" }));
  await wait();
  expect(screen.getByRole("alert").textContent).toContain("no run waits");
});
