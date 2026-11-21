import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { DeviceInfo } from "../../store/devices.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const phone: DeviceInfo = {
  id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  name: "iPhone 16",
  paired_at: "2026-11-12T10:00:00+01:00",
  last_seen: new Date(Date.now() - 2 * 60_000).toISOString(),
  revoked_at: null,
  rules: 2,
};
const old: DeviceInfo = {
  id: "ffffffffffffffffffffffffffffffff",
  name: "iPad",
  paired_at: "2026-10-02T10:00:00+02:00",
  last_seen: null,
  revoked_at: "2026-11-01T10:00:00+01:00",
  rules: 1,
};

function mount(devices: readonly DeviceInfo[], prepare?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", "/settings/devices");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.deviceList.mockResolvedValue({ devices: [...devices] });
  prepare?.(fake);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup(), ...view };
}

const main = () => screen.getByRole("main");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("empty: 0 phones, and how to pair one", async () => {
  mount([]);
  expect(await screen.findByText("0 phones")).toBeTruthy();
  expect(screen.getByText(/golem devices pair/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "+ Pair a phone" })).toBeTruthy();
});

test("one phone: its name, when it was paired and last seen, and the rules saved from it", async () => {
  mount([phone]);
  expect(await screen.findByText("1 phone")).toBeTruthy();
  const row = within(main()).getByRole("button", { name: /iPhone 16/ });
  expect(row.textContent).toContain("paired 12 Nov");
  expect(row.textContent).toContain("last seen 2 min ago");
  expect(row.textContent).toContain("2 rules saved from it");
  expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
});

test("a phone's details: rename, and Revoke is there", async () => {
  const { fake, user } = mount([phone]);
  await user.click(await screen.findByRole("button", { name: /iPhone 16/ }));
  expect(screen.getByRole("heading", { name: "iPhone 16" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Rename" }));
  const name = screen.getByRole("textbox", { name: "Name" });
  await user.clear(name);
  await user.type(name, "Pocket");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.deviceRename).toHaveBeenCalledWith(phone.id, "Pocket"));
  expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
});

test("pairing: the code shows as a QR code, then the words, and Pair it pairs the phone", async () => {
  const { fake, user } = mount([]);
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  expect(fake.raw.devicePairBegin).toHaveBeenCalledTimes(1);
  const qr = await screen.findByRole("img", { name: /Pairing code/ });
  expect(qr.querySelector("path")?.getAttribute("d")?.startsWith("M")).toBe(true);
  expect(screen.getByText(/It works once, until/)).toBeTruthy();
  // The phone shows the right code.
  act(() => {
    fake.emitPair({ pair: "p1", state: "words", words: ["kiln", "otter", "maple"], device: { id: phone.id, name: "iPhone 16", model: "iPhone17,3" } });
  });
  expect((await screen.findByLabelText("The words to compare")).textContent).toBe("kiln · otter · maple");
  expect(screen.getByText(/Confirm only if your phone shows the same words/)).toBeTruthy();
  expect(screen.getByText("iPhone 16").textContent).toBe("iPhone 16");
  fake.raw.deviceList.mockResolvedValue({ devices: [{ ...phone, rules: 0 }] });
  await user.click(screen.getByRole("button", { name: "Pair it" }));
  await waitFor(() => expect(fake.raw.devicePairConfirm).toHaveBeenCalledWith("p1", true));
  expect(await screen.findByText(/is paired\./)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("1 phone")).toBeTruthy();
});

test("pairing: Not these words refuses the phone and closes the panel", async () => {
  const { fake, user } = mount([]);
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  await screen.findByRole("img", { name: /Pairing code/ });
  act(() => {
    fake.emitPair({ pair: "p1", state: "words", words: ["a", "b", "c"], device: { id: phone.id, name: "iPhone 16", model: "" } });
  });
  await user.click(await screen.findByRole("button", { name: "Not these words" }));
  await waitFor(() => expect(fake.raw.devicePairConfirm).toHaveBeenCalledWith("p1", false));
  expect(await screen.findByText("0 phones")).toBeTruthy();
});

test("pairing: Cancel while the code is up tells the daemon", async () => {
  const { fake, user } = mount([]);
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  await screen.findByRole("img", { name: /Pairing code/ });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fake.raw.devicePairConfirm).toHaveBeenCalledWith("p1", false);
  expect(await screen.findByText("0 phones")).toBeTruthy();
});

test("pairing: a code that ends says so and offers a new one", async () => {
  const { fake, user } = mount([]);
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  await screen.findByRole("img", { name: /Pairing code/ });
  act(() => {
    fake.emitPair({ pair: "p1", state: "expired" });
  });
  expect((await screen.findByRole("status")).textContent).toContain("The code ended");
  await user.click(screen.getByRole("button", { name: "Show a new code" }));
  expect(fake.raw.devicePairBegin).toHaveBeenCalledTimes(2);
});

test("pairing: with no relay set the daemon's words are shown", async () => {
  const { fake, user } = mount([], (f) => {
    f.raw.devicePairBegin.mockRejectedValue(new Error('no relay is set: add [relay] url = "wss://..." to config.toml (for a local test, run `just relay`)'));
  });
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no relay is set");
  expect(fake.raw.devicePairConfirm).not.toHaveBeenCalled();
});

test("pairing: another pairing's notice (the terminal's) shows nothing here", async () => {
  const { fake } = mount([]);
  await screen.findByText("0 phones");
  act(() => {
    fake.emitPair({ pair: "other", state: "words", words: ["a", "b", "c"], device: { id: phone.id, name: "x", model: "" } });
  });
  expect(screen.queryByLabelText("The words to compare")).toBeNull();
});

test("revoke asks once, then lists the rules the phone made, marked, and the phone is revoked", async () => {
  const { fake, user } = mount([phone], (f) => {
    f.raw.deviceRevoke.mockResolvedValue({
      device: { ...phone, revoked_at: "2026-11-21T13:00:00+01:00" },
      revoked: true,
      rules: [
        { rule: "shell(git status)", at: "2026-11-13T10:00:00+01:00" },
        { rule: "fs.write(docs/**)", at: "2026-11-14T10:00:00+01:00" },
      ],
    });
  });
  await user.click(await screen.findByRole("button", { name: /iPhone 16/ }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Revoke iPhone 16?");
  expect(dialog.textContent).toContain('Its 2 "Always allow" rules stay.');
  expect(fake.raw.deviceRevoke).not.toHaveBeenCalled();
  fake.raw.deviceList.mockResolvedValue({ devices: [{ ...phone, revoked_at: "2026-11-21T13:00:00+01:00" }] });
  await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(fake.raw.deviceRevoke).toHaveBeenCalledWith(phone.id));
  const after = await screen.findByRole("region", { name: "After the revoke" });
  expect(after.textContent).toContain("iPhone 16 is cut off");
  expect(after.textContent).toContain("these 2 rules");
  expect(within(after).getAllByText(/from a revoked device/).length).toBeGreaterThanOrEqual(2);
  expect(within(after).getByText("shell(git status)")).toBeTruthy();
  expect(within(after).getByText("fs.write(docs/**)")).toBeTruthy();
  // The list reads again, and the phone is marked revoked.
  await waitFor(() => expect(within(main()).getAllByText(/revoked/).length).toBeGreaterThan(0));
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
});

test("revoke: Cancel in the question changes nothing", async () => {
  const { fake, user } = mount([phone]);
  await user.click(await screen.findByRole("button", { name: /iPhone 16/ }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.deviceRevoke).not.toHaveBeenCalled();
});

test("revoked: a revoked phone is listed last and is marked, with no Revoke", async () => {
  const { user } = mount([phone, old]);
  expect(await screen.findByText("2 phones")).toBeTruthy();
  const buttons = within(main()).getAllByRole("button", { name: /iPhone 16|iPad/ });
  expect(buttons.map((b) => b.textContent?.slice(0, 6))).toEqual(["iPhone", "iPadre"]);
  await user.click(buttons[1] as HTMLElement);
  expect(screen.getByRole("heading", { name: "iPad" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(screen.getByText(/1 rule saved from it/)).toBeTruthy();
});

test("a failed list says so, with Retry", async () => {
  const { fake, user } = mount([], (f) => {
    f.raw.deviceList.mockRejectedValue(new Error("daemon is down"));
  });
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("daemon is down");
  fake.raw.deviceList.mockResolvedValue({ devices: [] });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("0 phones")).toBeTruthy();
});

test("a pushed device.changed reads the list again", async () => {
  const { fake } = mount([]);
  await screen.findByText("0 phones");
  fake.raw.deviceList.mockResolvedValue({ devices: [phone] });
  act(() => {
    fake.emitDevices();
  });
  expect(await screen.findByText("1 phone")).toBeTruthy();
});

test("the QR card keeps light colours from tokens, with no raw colour", async () => {
  const { user } = mount([]);
  await user.click(await screen.findByRole("button", { name: "+ Pair a phone" }));
  const qr = await screen.findByRole("img", { name: /Pairing code/ });
  expect(qr.parentElement?.className).toContain("scheme-light");
  expect(qr.querySelector("path")?.getAttribute("class")).toBe("fill-ink");
});
