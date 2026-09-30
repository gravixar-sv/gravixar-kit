// createFormClock, the client half of the time trap. The browser's clocks are simulated: `Date.now()` is the
// device's wall clock, which can be minutes off the server's, and `performance.now()` is monotonic and counts from
// when the page began to load, so `mono = 0` is the page load.
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

/** Moves both of the device's clocks forward, as time passing does. */
function wait(ms) {
  wall += ms;
  mono += ms;
}

/**
 * A person opens the page, the form hydrates 1.5 s later, and they submit `fillMs` after the page began to load, when
 * the server's clock reads SERVER_NOW.
 */
function submitWithSkew(skewMs, fillMs) {
  wall = SERVER_NOW - fillMs + skewMs;
  wait(1_500);
  const clock = createFormClock();
  wait(fillMs - 1_500);
  return clock.fields();
}

test("fields() times from when the page began to load, as strings named for the gate", () => {
  wall = 1_000_000;
  wait(250.25); // the form hydrates and the clock is created
  const clock = createFormClock();
  wall += 12_000;
  mono += 12_000.6;
  assert.deepEqual(clock.fields(), { ts: "1000000", te: "12251" });
  assert.deepEqual(Object.keys(clock.fields()), [TIMESTAMP_FIELD, ELAPSED_FIELD]);
});

test("a form that hydrates late is timed from page load, so a person who typed while it hydrated isn't dropped", () => {
  // Measured on a live contact form, 2026-09-30: the form sits in a <Suspense> boundary and hydrated 19 s after the
  // page loaded. The person typed into the server-rendered form meanwhile and pressed send half a second after it
  // hydrated.
  wall = SERVER_NOW - 19_500;
  wait(19_000);
  const clock = createFormClock();
  wait(500);
  const fields = clock.fields();
  assert.equal(fields.te, "19500");
  assert.deepEqual(checkGate(fields, {}, SERVER_NOW), { ok: true });
  // A clock started at hydration measured half a second, and the gate dropped them while the page said "sent".
  assert.deepEqual(checkGate({ te: "500" }, {}, SERVER_NOW), { ok: false, reason: "ts_too_fast" });
});

test("a bot that loads the page and posts within two seconds is still too fast, however late the form mounts", () => {
  wall = SERVER_NOW - 1_800;
  wait(1_200);
  const clock = createFormClock();
  wait(600);
  assert.equal(clock.fields().te, "1800");
  assert.deepEqual(checkGate(clock.fields(), {}, SERVER_NOW), { ok: false, reason: "ts_too_fast" });
});

test("a clock created after a client-side navigation still counts from the first page load, which is only more lenient", () => {
  wall = 1_000;
  wait(60_000); // a minute on the site, then a client-side navigation renders the form
  const clock = createFormClock();
  wait(300);
  assert.deepEqual(clock.fields(), { ts: "1000", te: "60300" });
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
  wait(30_000);
  assert.equal(clock.fields().te, "30000");
  assert.deepEqual(checkGate(clock.fields(), {}, SERVER_NOW), { ok: true });
});

test("reset() times the next submission from now, not from page load", () => {
  wall = 100_000;
  wait(1_234);
  const clock = createFormClock();
  wait(40_000);
  assert.deepEqual(clock.fields(), { ts: "100000", te: "41234" });
  clock.reset();
  assert.deepEqual(clock.fields(), { ts: "141234", te: "0" });
  wait(25_000);
  assert.deepEqual(clock.fields(), { ts: "141234", te: "25000" });
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

test("without performance.now(), there is no page timeline, so the clock times from when it is created", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "performance", { value: undefined, configurable: true, writable: true });
  t.after(() => Object.defineProperty(globalThis, "performance", descriptor));
  wall = 1_000;
  const clock = createFormClock();
  wall += 7_000;
  assert.deepEqual(clock.fields(), { ts: "1000", te: "7000" });
});
