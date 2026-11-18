import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink";
import type { GolemClient } from "@golem/client";
import { App } from "./app.tsx";

/** A client that is already connected on the first render. Every call waits, and nothing is ever pushed. */
function connectedClient(): GolemClient {
  const base: Record<string, unknown> = {
    state: { status: "connected" },
    ready: Promise.resolve(),
  };
  return new Proxy(base, {
    get(target, key) {
      if (typeof key !== "string") {
        return undefined;
      }
      if (key in target) {
        return target[key];
      }
      if (/^on[A-Z]/.test(key)) {
        return () => () => {};
      }
      if (key === "close") {
        return () => {};
      }
      return () => new Promise(() => {});
    },
  }) as unknown as GolemClient;
}

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true;
  frames: string[] = [];
  write(chunk: string): boolean {
    this.frames.push(chunk);
    return true;
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode(): this {
    return this;
  }
  setEncoding(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  read(): null {
    return null;
  }
}

// `planOffered` read a session ref before the `useSession` block declared it, so a client that was
// connected before the first render crashed the TUI at start.
test("the first frame renders when the client is already connected", async () => {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const instance = render(createElement(App, { client: connectedClient() }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const output = stdout.frames.join("");
    assert.ok(!output.includes("ReferenceError") && !output.includes("ERROR"), `App crashed:\n${output.slice(0, 400)}`);
    assert.ok(output.includes("Type a message."), "the empty chat shows");
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
