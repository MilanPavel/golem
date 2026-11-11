import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DockView } from "./dock.tsx";

test("the approval sits directly above the composer, under the meter", () => {
  render(
    <DockView
      busy
      meter={<p>meter</p>}
      approval={<section role="group" aria-label="Approval" />}
      composer={<textarea aria-label="Message" />}
    />,
  );
  const meter = screen.getByText("meter");
  const approval = screen.getByRole("group", { name: "Approval" });
  const composer = screen.getByRole("textbox", { name: "Message" });
  expect(meter.compareDocumentPosition(approval) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(approval.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(approval.nextElementSibling).toBe(composer);
});
