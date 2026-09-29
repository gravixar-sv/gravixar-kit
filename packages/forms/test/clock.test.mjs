// createFormClock, the client half of the time trap. The browser's clocks are simulated: `Date.now()` is the
// device's wall clock, which can be minutes off the server's, and `performance.now()` is monotonic.
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createFormClock, ELAPSED_FIELD, TIMESTAMP_FIELD } from "../dist/index.js";
import { checkGate } from "../dist/server.js";

const SERVER_NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// The simulated device: `wall` is its Date.now(), `mono` its performance.now().
let wall;
let mono;
beforeEach(() => {
  wall = 0;
  mono = 0;
  mock.method(Date, "now", () => wall);
  mock.method(performance, "now", () => mono);
});
afterEach(() => mock.restoreAll());

/** A person opens the form, spends `fillMs` on it, and submits when the server's clock reads SERVER_NOW. */
function submitWithSkew(skewMs, fillMs) {
  wall = SERVER_NOW - fillMs + skewMs;
  mono = 5_000;
  const clock = createFormClock();
  wall += fillMs;
  mono += fillMs;
  return clock.fields();
}

test("fields() gives the opening time and the elapsed time, as strings named for the gate", () => {
  wall = 1_000_000;
  mono = 250.25;
  const clock = createFormClock();
  wall += 12_000;
  mono += 12_000.6;
  assert.deepEqual(clock.fields(), { ts: "1000000", te: "12001" });
  assert.deepEqual(Object.keys(clock.fields()), [TIMESTAMP_FIELD, ELAPSED_FIELD]);
});

for (const [label, skew] of [
  ["10 minutes fast", 10 * MINUTE],
  ["10 minutes slow", -10 * MINUTE],
  ["right", 0],
]) {
  test(`a real 30-second fill passes with a device clock ${label}`, () => {
    const fields = submitWithSkew(skew, 30_000);
    assert.equal(fields.te, "30000");
    assert.deepEqual(checkGate(fields, {}, SERVER_NOW), { ok: true });
  });
}

test("the timestamp alone drops the same person when the clock is fast: the problem the elapsed field solves", () => {
  const { ts } = submitWithSkew(10 * MINUTE, 30_000);
  assert.deepEqual(checkGate({ ts }, {}, SERVER_NOW), { ok: false, reason: "ts_too_fast" });
});

test("a tab left open for three days passes; the timestamp alone would have been stale", () => {
  const fields = submitWithSkew(0, 3 * DAY);
  assert.deepEqual(checkGate(fields, {}, SERVER_NOW), { ok: true });
  assert.deepEqual(checkGate({ ts: fields.ts }, {}, SERVER_NOW), { ok: false, reason: "ts_stale" });
});

test("a clock corrected mid-fill doesn't change the elapsed time", () => {
  wall = SERVER_NOW + 10 * MINUTE;
  const clock = createFormClock();
  wall -= 10 * MINUTE; // the device syncs its clock back while the person types
  mono += 30_000;
  wall += 30_000;
  assert.equal(clock.fields().te, "30000");
  assert.deepEqual(checkGate(clock.fields(), {}, SERVER_NOW), { ok: true });
});

test("reset() times the next submission from now", () => {
  wall = 1_000;
  mono = 1_234;
  const clock = createFormClock();
  wall += 40_000;
  mono += 40_000;
  assert.equal(clock.fields().te, "40000");
  clock.reset();
  assert.deepEqual(clock.fields(), { ts: "41000", te: "0" });
  wall += 25_000;
  mono += 25_000;
  assert.deepEqual(clock.fields(), { ts: "41000", te: "25000" });
});

test("a bot that submits at once is still too fast", () => {
  const clock = createFormClock();
  mono += 300;
  assert.deepEqual(checkGate(clock.fields(), {}, Date.now()), { ok: false, reason: "ts_too_fast" });
});

test("stamp() sets both fields in FormData, replacing any value already there", () => {
  wall = 1_000;
  const clock = createFormClock();
  mono += 9_000;
  const fd = new FormData();
  fd.append("name", "Jane");
  fd.append("te", "");
  fd.append("ts", "");
  clock.stamp(fd);
  assert.deepEqual(fd.getAll("te"), ["9000"]);
  assert.deepEqual(fd.getAll("ts"), ["1000"]);
  assert.equal(fd.get("name"), "Jane");
});

test("stamp() writes a form's inputs, adding a hidden one for a field the form doesn't render", () => {
  wall = 1_000;
  const clock = createFormClock();
  mono += 9_000;
  const ts = { value: "" };
  const added = [];
  const form = {
    elements: { namedItem: (name) => (name === "ts" ? ts : null) },
    ownerDocument: { createElement: (tag) => ({ tag }) },
    append: (node) => added.push(node),
  };
  clock.stamp(form);
  assert.equal(ts.value, "1000");
  assert.deepEqual(added, [{ tag: "input", type: "hidden", name: "te", value: "9000" }]);
});

test("without performance.now(), the elapsed time comes from Date.now()", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "performance", { value: undefined, configurable: true, writable: true });
  t.after(() => Object.defineProperty(globalThis, "performance", descriptor));
  wall = 1_000;
  const clock = createFormClock();
  wall += 7_000;
  assert.deepEqual(clock.fields(), { ts: "1000", te: "7000" });
});
