import assert from "node:assert/strict";
import { test } from "node:test";

import {
  copyAnswer,
  copyCode,
  exportDestination,
  exportFileName,
  followTail,
  formatDuration,
  formatMessageTime,
  newLinesLabel,
  sessionMarkdown,
} from "./transcript.ts";

test("copy takes the last answer, or the last fenced block", () => {
  const messages = [
    { role: "user", text: "show me\n\n```\nold\n```" },
    { role: "assistant", text: "first" },
    { role: "assistant", text: "use this\n\n```ts\nconst n = 1\n```\n\nthen\n\n```\nlast\n```" },
  ];
  assert.equal(copyAnswer(messages), messages[2]?.text);
  assert.equal(copyAnswer([{ role: "user", text: "hi" }, { role: "assistant", text: "" }]), null);
  assert.equal(copyCode(messages), "last");
  assert.equal(copyCode([{ role: "assistant", text: "no fence" }]), null);
});

test("export is markdown from the messages, named from the title", () => {
  assert.equal(
    sessionMarkdown("Trip\nplans", [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi\n\n```\ncode\n```" },
    ]),
    "# Trip plans\n\n**you**\n\nhello\n\n**golem**\n\nhi\n\n```\ncode\n```\n",
  );
  assert.equal(sessionMarkdown("  ", []), "# untitled\n");
  assert.equal(exportFileName("a/b:c"), "a-b-c.md");
  assert.equal(exportFileName("   "), "untitled.md");
  assert.equal(
    exportDestination({ env: { GOLEM_HOME: "/tmp/golem-home" }, home: "/home/me", title: "Trip", given: null }),
    "/tmp/golem-home/exports/Trip.md",
  );
  assert.equal(
    exportDestination({ env: {}, home: "/home/me", title: "Trip", given: "  ~/out/chat.md  " }),
    "/home/me/out/chat.md",
  );
});

test("duration and message time format for the transcript", () => {
  assert.equal(formatDuration(12_400), "12.4s");
  assert.equal(formatDuration(400), "0.4s");
  assert.equal(formatDuration(90_400), "1m 30s");
  assert.equal(formatDuration(Number.NaN), "");
  const now = new Date(2026, 9, 17, 18, 0, 0).getTime();
  const today = new Date(2026, 9, 17, 14, 2, 30).toISOString();
  const older = new Date(2026, 9, 16, 14, 2, 0).toISOString();
  assert.equal(formatMessageTime(today, now), "14:02");
  assert.equal(formatMessageTime(older, now), "2026-10-16 14:02");
  assert.equal(formatMessageTime("not a time", now), "");
});

test("new rows stay below a scrolled view and clear at the bottom", () => {
  assert.equal(newLinesLabel(0), "");
  assert.equal(newLinesLabel(1), "\u2193 1 new line");
  assert.equal(newLinesLabel(4), "\u2193 4 new lines");

  const started = followTail(null, 10, 40, 0);
  assert.equal(started.fresh, 0);
  assert.equal(started.offset, 0);

  const away = followTail(started.anchor, 10, 40, 4);
  assert.equal(away.offset, 4);
  assert.equal(away.fresh, 0);

  const grown = followTail(away.anchor, 13, 40, 4);
  assert.equal(grown.offset, 7);
  assert.equal(grown.fresh, 3);
  const again = followTail(grown.anchor, 13, 40, grown.offset);
  assert.equal(again.offset, 7);
  assert.equal(again.fresh, 3);

  const reflow = followTail(grown.anchor, 20, 20, grown.offset);
  assert.equal(reflow.offset, grown.offset);
  assert.equal(reflow.fresh, 3);

  const back = followTail(reflow.anchor, 20, 20, 0);
  assert.equal(back.fresh, 0);
  assert.equal(back.offset, 0);
});
