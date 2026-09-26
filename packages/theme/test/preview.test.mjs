// Runs the generated preview script the way a browser would, against a fake location, storage and <html>.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { defineTheme } from "../dist/index.js";

const theme = defineTheme({
  axes: {
    palette: { options: { day: { tokens: { ink: "#111111" } }, dusk: { tokens: { ink: "#EEEEEE" } } }, default: "day" },
    type: { options: { sans: { tokens: { weight: 400 } }, serif: { tokens: { weight: 500 } } }, default: "sans" },
  },
  preview: { keyPrefix: "site-" },
});

/** One page load: returns the attributes set on <html>. `storage` carries over between loads, as in one tab. */
function load(script, search, storage = new Map(), { blocked = false } = {}) {
  const attributes = {};
  const context = {
    URLSearchParams,
    location: { search },
    document: { documentElement: { setAttribute: (name, value) => (attributes[name] = value) } },
  };
  Object.defineProperty(context, "sessionStorage", {
    get() {
      if (blocked) throw new Error("SecurityError: storage is blocked");
      return {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
      };
    },
  });
  vm.runInNewContext(script, context);
  return attributes;
}

test("?<axis>=<id> previews the option, and the preview lasts for the visit", () => {
  const script = theme.previewScript();
  const storage = new Map();
  assert.deepEqual(load(script, "?palette=dusk&type=serif", storage), { "data-palette": "dusk", "data-type": "serif" });
  assert.deepEqual(Object.fromEntries(storage), { "site-preview-palette": "dusk", "site-preview-type": "serif" });
  assert.deepEqual(load(script, "", storage), { "data-palette": "dusk", "data-type": "serif" }, "the next page keeps it");
});

test("unknown ids are ignored, so the page stays on the saved theme", () => {
  const storage = new Map();
  assert.deepEqual(load(theme.previewScript(), '?palette=night&type="><script>', storage), {});
  assert.equal(storage.size, 0);
});

test("?preview=off ends the preview", () => {
  const storage = new Map([["site-preview-palette", "dusk"], ["other", "kept"]]);
  assert.deepEqual(load(theme.previewScript(), "?preview=off", storage), {});
  assert.deepEqual(Object.fromEntries(storage), { other: "kept" });
});

test("blocked storage leaves the saved theme and throws nothing", () => {
  assert.deepEqual(load(theme.previewScript(), "?palette=dusk", new Map(), { blocked: true }), {});
});

test("axis initials that clash, or that the script already uses, get numbered names and still work", () => {
  for (const names of [["shape", "size"], ["palette", "pattern"], ["density"], ["e-mode"]]) {
    const token = (n) => n.replace(/-/g, "");
    const axes = Object.fromEntries(names.map((n) => [n, { options: { a: { tokens: { [token(n)]: 1 } }, b: { tokens: { [token(n)]: 2 } } }, default: "a" }]));
    const numbered = defineTheme({ axes });
    const script = numbered.previewScript();
    assert.match(script, /V0=\["a","b"\]/, names.join(","));
    const expected = Object.fromEntries(names.map((n) => [`data-${n}`, "b"]));
    assert.deepEqual(load(script, `?${names.map((n) => `${n}=b`).join("&")}`), expected, names.join(","));
  }
});

test("the script can't close its <script> element", () => {
  assert.doesNotMatch(theme.previewScript(), /<\//);
});
