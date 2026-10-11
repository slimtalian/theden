import test from "node:test";
import assert from "node:assert/strict";
import { swipePageDelta } from "../public/reader-gestures.js";

test("deliberate horizontal swipes turn in the expected reading direction", () => {
  assert.equal(swipePageDelta(-130, 20, 250), 1);
  assert.equal(swipePageDelta(90, -10, 400), -1);
});

test("taps, vertical scrolling, diagonal drags and selection holds do not turn a page", () => {
  assert.equal(swipePageDelta(-10, 0, 100), 0);
  assert.equal(swipePageDelta(55, 180, 300), 0);
  assert.equal(swipePageDelta(-100, 90, 300), 0);
  assert.equal(swipePageDelta(-130, 5, 900), 0);
});
