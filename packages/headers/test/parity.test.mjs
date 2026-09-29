// The package must return what the builder it was extracted from returns, so a site switching to it sends the same
// headers. test/fixtures/core-parity.json records that builder's output for each case; it was generated outside this
// repo, which never imports the original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as headers from "../dist/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/core-parity.json", import.meta.url), "utf8"));
const PREFIX = "[@gravixar/headers] ";

// {"$undefined": true} stands for undefined. The key stays present, which is what the undefined cases test.
const revive = (value) => {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    if (value.$undefined === true && Object.keys(value).length === 1) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
};

test("the fixture records a released version and covers all three functions", () => {
  assert.match(fixture.source.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(new Set(fixture.cases.map((c) => c.fn)), new Set(["buildHeaders", "serializeCsp", "serializePermissionsPolicy"]));
  assert.ok(fixture.cases.length >= 80, `only ${fixture.cases.length} cases`);
  assert.equal(new Set(fixture.cases.map((c) => c.name)).size, fixture.cases.length, "case names are unique");
});

test("the defaults match, key for key and in the same order", () => {
  assert.deepEqual(headers.DEFAULT_CSP_DIRECTIVES, fixture.defaults.csp);
  assert.deepEqual(Object.keys(headers.DEFAULT_CSP_DIRECTIVES), Object.keys(fixture.defaults.csp));
  assert.deepEqual(headers.DEFAULT_PERMISSIONS_POLICY, fixture.defaults.permissionsPolicy);
  assert.deepEqual(Object.keys(headers.DEFAULT_PERMISSIONS_POLICY), Object.keys(fixture.defaults.permissionsPolicy));
});

for (const c of fixture.cases) {
  test(`${c.fn}: ${c.name}`, () => {
    const args = revive(c.args);
    if (c.error) {
      assert.throws(
        () => headers[c.fn](...args),
        (err) => {
          assert.equal(err.name, c.error.name);
          assert.ok(err.message.startsWith(PREFIX), err.message);
          assert.equal(err.message.slice(PREFIX.length), c.error.message);
          return true;
        },
      );
    } else {
      assert.deepEqual(headers[c.fn](...args), c.result);
    }
  });
}
