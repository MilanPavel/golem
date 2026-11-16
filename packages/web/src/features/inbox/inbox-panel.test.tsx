import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { inboxKey } from "../../store/inbox.ts";
import { InboxPanel } from "./inbox-panel.tsx";
import { SAMPLE_INBOX } from "./sample.ts";

const [consent, edit, shell] = SAMPLE_INBOX as [(typeof SAMPLE_INBOX)[number], (typeof SAMPLE_INBOX)[number], (typeof SAMPLE_INBOX)[number]];

function show(props: Partial<Parameters<typeof InboxPanel>[0]> = {}) {
  const onAnswer = vi.fn();
  const onOpen = vi.fn();
  render(<InboxPanel items={SAMPLE_INBOX} onAnswer={onAnswer} onOpen={onOpen} {...props} />);
  return { onAnswer, onOpen };
}

test("the cards come in the order given, with headline, session, age and rule", () => {
  show();
  const cards = screen.getAllByRole("listitem");
  expect(cards.map((card) => card.getAttribute("data-inbox-card"))).toEqual(["consent", "approval", "approval"]);
  expect(cards[0]?.textContent).toContain("Use a paid model for this message?");
  expect(cards[1]?.textContent).toContain("+12 −4");
  expect(cards[2]?.textContent).toContain("git push origin main");
  expect(cards[2]?.textContent).toContain("Fix drawer resize jitter");
  expect(cards[2]?.textContent).toContain("4m");
  expect(cards[2]?.textContent).toContain("built-in default");
  const reversed = [...SAMPLE_INBOX].reverse();
  render(<InboxPanel items={reversed} label="Reversed" onAnswer={() => {}} onOpen={() => {}} />);
  expect(within(screen.getByRole("list", { name: "Reversed" })).getAllByRole("listitem")[0]?.getAttribute("data-inbox-card")).toBe("approval");
});

test("an approval has four buttons and a consent only Open", () => {
  show();
  const cards = screen.getAllByRole("listitem");
  expect(within(cards[2]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once", "Allow for this session", "Deny", "Open"]);
  expect(within(cards[0]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Open"]);
  expect(screen.queryByText("Always allow")).toBeNull();
});

test("a button has the session in its name and calls back with its item", () => {
  const { onAnswer, onOpen } = show();
  fireEvent.click(screen.getByRole("button", { name: "Allow once, Fix drawer resize jitter" }));
  expect(onAnswer).toHaveBeenLastCalledWith(shell, "allow");
  fireEvent.click(screen.getByRole("button", { name: "Allow for this session, Move the sidebar to a rail" }));
  expect(onAnswer).toHaveBeenLastCalledWith(edit, "allow_session");
  fireEvent.click(screen.getByRole("button", { name: "Deny, Fix drawer resize jitter" }));
  expect(onAnswer).toHaveBeenLastCalledWith(shell, "deny");
  fireEvent.click(screen.getByRole("button", { name: "Open, Nightly dependency check" }));
  expect(onOpen).toHaveBeenCalledWith(consent);
});

test("busy disables the answers of that card only, and Open stays", () => {
  show({ busy: { [inboxKey(shell)]: true } });
  expect((screen.getByRole("button", { name: "Allow once, Fix drawer resize jitter" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Deny, Fix drawer resize jitter" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Open, Fix drawer resize jitter" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Allow once, Move the sidebar to a rail" }) as HTMLButtonElement).disabled).toBe(false);
});

test("an error shows on its card", () => {
  show({ errors: { [inboxKey(edit)]: "golem is still answering." } });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("golem is still answering.");
  expect(screen.getAllByRole("listitem")[1]?.contains(alert)).toBe(true);
  expect(alert.className).toContain("text-deny");
});

test("with nothing waiting it says so", () => {
  show({ items: [] });
  expect(screen.getByText("Nothing is waiting for you.")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});
