import { expect, test, vi } from "vitest";
import { exchangeToken, takeLoginToken } from "./login.ts";

function page(hash: string) {
  const replaceState = vi.fn();
  return { loc: { hash, pathname: "/chat", search: "?a=1" }, hist: { replaceState }, replaceState };
}

test("the token is read from the hash, and the whole hash is removed", () => {
  const { loc, hist, replaceState } = page("#t=abc123");
  expect(takeLoginToken(loc, hist)).toBe("abc123");
  expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/chat?a=1");
});

test("an empty token is removed from the address and is not a token", () => {
  const { loc, hist, replaceState } = page("#t=");
  expect(takeLoginToken(loc, hist)).toBeNull();
  expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/chat?a=1");
});

test("no hash gives null and leaves the address alone", () => {
  const { loc, hist, replaceState } = page("");
  expect(takeLoginToken(loc, hist)).toBeNull();
  expect(replaceState).not.toHaveBeenCalled();
});

test("the hash is removed before any network call", async () => {
  const order: string[] = [];
  const { loc } = page("#t=abc");
  const token = takeLoginToken(loc, { replaceState: () => order.push("replaceState") });
  const fetchFn = vi.fn(async () => {
    order.push("fetch");
    return new Response(null, { status: 204 });
  });
  await exchangeToken(token ?? "", fetchFn);
  expect(order).toEqual(["replaceState", "fetch"]);
});

test("the exchange posts the token as JSON with same-origin credentials", async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  expect(await exchangeToken("abc", fetchFn)).toBe(true);
  const [url, init] = fetchFn.mock.calls[0] ?? [];
  expect(url).toBe("/auth/exchange");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({ token: "abc" });
});

test("the exchange is true only for 204", async () => {
  for (const status of [200, 401, 403, 500]) {
    const body = status === 200 ? "{}" : null;
    expect(await exchangeToken("abc", async () => new Response(body, { status }))).toBe(false);
  }
});
