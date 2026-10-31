import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Radix uses a few browser APIs that jsdom lacks. Files that run in node have no DOM, so skip them.
if (typeof Element !== "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub;

  const proto = Element.prototype;
  proto.scrollIntoView ??= () => {};
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};

  afterEach(cleanup);
}
