import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGate, MAX_FORM_AGE_MS, MIN_FILL_MS } from "../dist/server.js";

const NOW = 1_800_000_000_000;
const ts = NOW - 10_000;
const gate = (input, options) => checkGate(input, options, NOW);
const tripped = (input, options) => {
  const verdict = gate(input, options);
  assert.equal(verdict.ok, false, `expected the gate to trip for ${JSON.stringify(input)}`);
  return verdict.reason;
};

test("a person's submission passes", () => {
  assert.deepEqual(gate({ name: "Jane", website: "", ts }), { ok: true });
  assert.deepEqual(gate({ name: "Jane", ts: String(ts) }), { ok: true });
});

test("a filled honeypot trips; blank, absent and null don't", () => {
  assert.equal(tripped({ website: "https://spam.example", ts }), "honeypot_filled");
  assert.deepEqual(gate({ website: "   ", ts }), { ok: true });
  assert.deepEqual(gate({ ts }), { ok: true });
  // null used to read as a malformed honeypot, dropping the submission.
  assert.deepEqual(gate({ website: null, ts }), { ok: true });
});

test("anything in the honeypot but text trips it", () => {
  assert.equal(tripped({ website: 1, ts }), "honeypot_filled");
  assert.equal(tripped({ website: ["x"], ts }), "honeypot_filled");
  assert.equal(tripped({ website: new File(["x"], "x.txt"), ts }), "honeypot_filled");
});

test("the legacy honeypot name is checked too", () => {
  assert.equal(tripped({ hp_website: "filled", ts }), "honeypot_filled");
  assert.equal(tripped({ hp_website: "filled", ts }, { honeypot: "company_url" }), "honeypot_filled");
});

test("a custom honeypot name, and turning it off", () => {
  assert.equal(tripped({ company_url: "x", ts }, { honeypot: "company_url" }), "honeypot_filled");
  assert.deepEqual(gate({ website: "x", ts }, { honeypot: "company_url" }), { ok: true });
  assert.deepEqual(gate({ website: "x", hp_website: "x", ts }, { honeypot: false }), { ok: true });
});

test("a missing timestamp fails the time trap", () => {
  // Before, omitting the field skipped the trap entirely.
  assert.equal(tripped({}), "ts_missing");
  assert.equal(tripped({ ts: "" }), "ts_missing");
  assert.equal(tripped({ ts: null }), "ts_missing");
});

test("a timestamp that isn't a number is invalid", () => {
  assert.equal(tripped({ ts: "yesterday" }), "ts_invalid");
  assert.equal(tripped({ ts: {} }), "ts_invalid");
  assert.equal(tripped({ ts: "Infinity" }), "ts_invalid");
});

test("too fast, too old, and the edges", () => {
  assert.equal(tripped({ ts: NOW - MIN_FILL_MS + 1 }), "ts_too_fast");
  assert.deepEqual(gate({ ts: NOW - MIN_FILL_MS }), { ok: true });
  assert.deepEqual(gate({ ts: NOW - MAX_FORM_AGE_MS }), { ok: true });
  assert.equal(tripped({ ts: NOW - MAX_FORM_AGE_MS - 1 }), "ts_stale");
  // A client clock ahead of the server reads as too fast.
  assert.equal(tripped({ ts: NOW + 60_000 }), "ts_too_fast");
});

test("the time trap's field and limits can be set, or it can be turned off", () => {
  assert.deepEqual(gate({ rendered: NOW - 600 }, { timeTrap: { field: "rendered", minMs: 500 } }), { ok: true });
  assert.equal(tripped({ ts: NOW - 5_000 }, { timeTrap: { maxAgeMs: 1_000 } }), "ts_stale");
  assert.deepEqual(gate({}, { timeTrap: false }), { ok: true });
});

test("the honeypot is checked before the timestamp", () => {
  assert.equal(tripped({ website: "x" }), "honeypot_filled");
});
