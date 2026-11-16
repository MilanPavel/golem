import assert from "node:assert/strict";
import { test } from "node:test";

import { helperStop, helperStopWords } from "./helper.ts";

test("helperStopWords: a helper that is done says nothing", () => {
  assert.equal(helperStopWords("done"), "");
});

test("helperStopWords: each limit has words", () => {
  assert.equal(helperStopWords("calls"), "stopped: call limit");
  assert.equal(helperStopWords("time"), "stopped: time limit");
  assert.equal(helperStopWords("budget"), "stopped: budget spent");
  assert.equal(helperStopWords("tokens"), "stopped: token limit");
  assert.equal(helperStopWords("cancelled"), "stopped: cancelled");
  assert.equal(helperStopWords("later"), "stopped: later");
});

test("helperStop: reads the first line of a result", () => {
  assert.equal(helperStop("explorer finished: budget\n\nwhat I know"), "budget");
  assert.equal(helperStop("the answer"), "done");
});
