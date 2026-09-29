// The time trap's elapsed path: the browser measures how long the form was open against its own clock, so a device
// clock that is off can't make a person look too fast or too old.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGate, ELAPSED_FIELD, MAX_FORM_AGE_MS, MIN_FILL_MS } from "../dist/server.js";

const NOW = 1_800_000_000_000;
const gate = (input, options) => checkGate(input, options, NOW);
const tripped = (input, options) => {
  const verdict = gate(input, options);
  assert.equal(verdict.ok, false, `expected the gate to trip for ${JSON.stringify(input)}`);
  return verdict.reason;
};

test("the field is te", () => {
  assert.equal(ELAPSED_FIELD, "te");
});

test("an elapsed time passes on its own, as a number or a numeric string", () => {
  assert.deepEqual(gate({ te: 30_000 }), { ok: true });
  assert.deepEqual(gate({ te: "30000" }), { ok: true });
  assert.deepEqual(gate({ te: "30000.4" }), { ok: true });
});

test("too fast, and the edge", () => {
  assert.equal(tripped({ te: 0 }), "ts_too_fast");
  assert.equal(tripped({ te: MIN_FILL_MS - 1 }), "ts_too_fast");
  assert.equal(tripped({ te: String(MIN_FILL_MS - 1) }), "ts_too_fast");
  assert.deepEqual(gate({ te: MIN_FILL_MS }), { ok: true });
});

test("no age limit: a tab open for days, or a huge value, still passes", () => {
  assert.deepEqual(gate({ te: MAX_FORM_AGE_MS + 1 }), { ok: true });
  assert.deepEqual(gate({ te: 3 * MAX_FORM_AGE_MS }), { ok: true });
  assert.deepEqual(gate({ te: "1e15" }), { ok: true });
  assert.deepEqual(gate({ te: Number.MAX_SAFE_INTEGER }), { ok: true });
  // maxAgeMs is the timestamp's limit only.
  assert.deepEqual(gate({ te: 5_000 }, { timeTrap: { maxAgeMs: 3_000 } }), { ok: true });
});

test("when both are sent, the elapsed time decides and the timestamp is ignored", () => {
  assert.deepEqual(gate({ te: 30_000, ts: NOW + 10 * 60_000 }), { ok: true }); // a clock 10 minutes fast
  assert.deepEqual(gate({ te: 30_000, ts: NOW - MAX_FORM_AGE_MS - 1 }), { ok: true }); // a stale timestamp
  assert.deepEqual(gate({ te: 30_000, ts: "yesterday" }), { ok: true }); // an unreadable one
  assert.equal(tripped({ te: 500, ts: NOW - 30_000 }), "ts_too_fast"); // a fast bot with a plausible timestamp
});

// Every timestamp outcome, and what the gate says with no elapsed field at all.
const TIMESTAMP_CASES = [
  [{ ts: NOW - 10_000 }, { ok: true }],
  [{}, { ok: false, reason: "ts_missing" }],
  [{ ts: "yesterday" }, { ok: false, reason: "ts_invalid" }],
  [{ ts: NOW + 60_000 }, { ok: false, reason: "ts_too_fast" }],
  [{ ts: NOW - MAX_FORM_AGE_MS - 1 }, { ok: false, reason: "ts_stale" }],
];

// Absent, blank, or not a finite non-negative number. A hand-rolled `Date.now() - mount` goes negative when the
// device's clock is corrected mid-fill, so an unusable value is ignored, never rejected: rejecting it would drop a
// person, and a bot gains nothing from the fallback because it could leave the field out.
const UNUSABLE = [
  undefined, null, "", "   ",
  "soon", "Infinity", "-Infinity", "NaN", Infinity, -Infinity, NaN,
  -1, "-5000", -0.5,
  {}, [], ["30000"], true, false,
];

test("with no elapsed field, the timestamp is checked as in 0.1.0", () => {
  for (const [input, expected] of TIMESTAMP_CASES) assert.deepEqual(gate(input), expected, JSON.stringify(input));
});

test("an unusable elapsed time is ignored: the gate says exactly what it says without one", () => {
  for (const te of UNUSABLE) {
    for (const [input, expected] of TIMESTAMP_CASES) {
      const label = `te = ${typeof te === "object" ? JSON.stringify(te) : String(te)}, ${JSON.stringify(input)}`;
      assert.deepEqual(gate({ ...input, te }), expected, label);
      assert.deepEqual(gate({ ...input, te }), gate(input), label);
    }
  }
});

test("a negative elapsed time from a clock corrected mid-fill falls back to a good timestamp", () => {
  assert.deepEqual(gate({ te: "-599970000", ts: NOW - 30_000 }), { ok: true });
});

test("the field and the minimum can be set, and turning the trap off ignores it", () => {
  assert.deepEqual(gate({ open_ms: 600 }, { timeTrap: { elapsedField: "open_ms", minMs: 500 } }), { ok: true });
  assert.equal(tripped({ open_ms: 400 }, { timeTrap: { elapsedField: "open_ms", minMs: 500 } }), "ts_too_fast");
  // With a custom name, a "te" field is not read.
  assert.equal(tripped({ te: 30_000 }, { timeTrap: { elapsedField: "open_ms" } }), "ts_missing");
  assert.deepEqual(gate({ te: "garbage" }, { timeTrap: false }), { ok: true });
});

test("the honeypot is still checked first", () => {
  assert.equal(tripped({ website: "x", te: 30_000 }), "honeypot_filled");
});
