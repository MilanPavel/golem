import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ALL_CLOUD, ALL_LOCAL, askingBatchChat, cloudBatchChat, localBatchChat } from "./helper-card-sample.ts";
import { closeHelper, useHelperOpen } from "./helper-open.ts";
import { TranscriptMessages } from "./transcript.tsx";

afterEach(() => {
  cleanup();
  closeHelper();
});

function Open() {
  const open = useHelperOpen();
  return <p data-testid="open">{open === null ? "none" : `${open.callId}:${open.helperId}`}</p>;
}

test("at Normal the card is in the transcript with no steps group to unfold", () => {
  render(<TranscriptMessages chat={localBatchChat()} detail="normal" isLocal={ALL_LOCAL} />);
  const card = screen.getByRole("group", { name: "Helpers" });
  expect(card.textContent).toContain("3 helpers");
  expect(within(card).getAllByRole("button")).toHaveLength(3);
  // The delegate call is not a row in a collapsed steps group.
  expect(document.querySelector("[data-activity]")).toBeNull();
});

test("a row opens its helper in the panel, and says its state to a screen reader", () => {
  render(
    <>
      <TranscriptMessages chat={localBatchChat()} detail="normal" isLocal={ALL_LOCAL} />
      <Open />
    </>,
  );
  const row = screen.getByRole("button", { name: /^Open docs, running/ });
  fireEvent.click(row);
  expect(screen.getByTestId("open").textContent).toBe("d1:h2");
  expect(screen.getByRole("button", { name: /^Open tests, / }).getAttribute("aria-label")).toBeTruthy();
});

test("quiet is one line and no buttons", () => {
  render(<TranscriptMessages chat={localBatchChat()} detail="quiet" isLocal={ALL_LOCAL} />);
  expect(screen.queryByRole("group", { name: "Helpers" })).toBeNull();
  const line = document.querySelector("[data-batch-card]");
  expect(line?.textContent).toBe("3 helpers · 1 running · 1 queued · 1 done");
  expect(line?.querySelector("button")).toBeNull();
});

test("verbose adds the model and why it was picked to each row", () => {
  render(<TranscriptMessages chat={localBatchChat()} detail="verbose" isLocal={ALL_LOCAL} />);
  expect(screen.getAllByText("ollama/qwen3:27b · fits your machine")).toHaveLength(3);
});

test("local only: the number is the window saved, with no cost", () => {
  render(<TranscriptMessages chat={localBatchChat()} detail="normal" isLocal={ALL_LOCAL} />);
  const card = screen.getByRole("group", { name: "Helpers" });
  expect(card.textContent).toContain("14K to 0.6K");
  expect(card.textContent).not.toContain("$");
});

test("cloud only: the cost comes first", () => {
  render(<TranscriptMessages chat={cloudBatchChat()} detail="normal" isLocal={ALL_CLOUD} />);
  const card = screen.getByRole("group", { name: "Helpers" });
  expect(card.textContent).toContain("$0.04 · 14K to 0.6K");
});

test("a helper that asks says so in its row and on the head", () => {
  render(<TranscriptMessages chat={askingBatchChat()} detail="normal" isLocal={ALL_LOCAL} />);
  const row = screen.getByRole("button", { name: /^Open writer, / });
  expect(row.getAttribute("aria-label")).toMatch(/you/i);
});
