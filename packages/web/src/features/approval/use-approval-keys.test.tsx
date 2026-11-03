import { fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useApprovalKeys } from "./use-approval-keys.ts";

function Probe({ callId = "c1", canAnswer = () => true, onAnswer }: { callId?: string | null; canAnswer?: () => boolean; onAnswer: (id: string, d: string) => void }) {
  useApprovalKeys({ callId, canAnswer, onAnswer });
  return (
    <div>
      <textarea aria-label="Message" />
      <button type="button">Other</button>
      <div role="dialog">
        <span tabIndex={0} data-testid="in-dialog" />
      </div>
    </div>
  );
}

test("Enter, s, w, and d on the page answer", () => {
  const onAnswer = vi.fn();
  render(<Probe onAnswer={onAnswer} />);
  fireEvent.keyDown(document.body, { key: "Enter" });
  fireEvent.keyDown(document.body, { key: "s" });
  fireEvent.keyDown(document.body, { key: "W" });
  fireEvent.keyDown(document.body, { key: "d" });
  expect(onAnswer.mock.calls).toEqual([
    ["c1", "allow"],
    ["c1", "allow_session"],
    ["c1", "allow_always"],
    ["c1", "deny"],
  ]);
});

test("a key is ignored when the composer has text", () => {
  const onAnswer = vi.fn();
  render(<Probe onAnswer={onAnswer} canAnswer={() => false} />);
  fireEvent.keyDown(document.body, { key: "d" });
  expect(onAnswer).not.toHaveBeenCalled();
});

test("a key is ignored in a field, in an overlay, with a modifier, and on repeat", () => {
  const onAnswer = vi.fn();
  const view = render(<Probe onAnswer={onAnswer} />);
  fireEvent.keyDown(view.getByLabelText("Message"), { key: "d" });
  fireEvent.keyDown(view.getByTestId("in-dialog"), { key: "d" });
  fireEvent.keyDown(document.body, { key: "d", metaKey: true });
  fireEvent.keyDown(document.body, { key: "d", ctrlKey: true });
  fireEvent.keyDown(document.body, { key: "d", altKey: true });
  fireEvent.keyDown(document.body, { key: "d", repeat: true });
  expect(onAnswer).not.toHaveBeenCalled();
});

test("Enter on a focused button stays the button's, but d still answers", () => {
  const onAnswer = vi.fn();
  const view = render(<Probe onAnswer={onAnswer} />);
  const button = view.getByRole("button", { name: "Other" });
  fireEvent.keyDown(button, { key: "Enter" });
  expect(onAnswer).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "d" });
  expect(onAnswer).toHaveBeenCalledWith("c1", "deny");
});

test("with no pending call there is no listener", () => {
  const onAnswer = vi.fn();
  render(<Probe callId={null} onAnswer={onAnswer} />);
  fireEvent.keyDown(document.body, { key: "d" });
  expect(onAnswer).not.toHaveBeenCalled();
});
