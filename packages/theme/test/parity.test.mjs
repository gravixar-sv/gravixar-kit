// The package must reproduce the pilot site exactly, so adopting it changes nothing a visitor receives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { theme } from "./fixtures/pilot/theme.mjs";

const dir = new URL("./fixtures/pilot/golden/", import.meta.url);
const golden = (name) => readFileSync(new URL(name, dir), "utf8");

test("renders the pilot's <head> CSS byte for byte, for every preset and heading set", () => {
  for (const preset of theme.axes.preset.ids) {
    for (const headings of theme.axes.headings.ids) {
      assert.equal(theme.css({ preset, headings }), golden(`${preset}--${headings}.css`), `${preset} + ${headings}`);
    }
  }
});

test("every golden file is compared: none is skipped by a missing id", () => {
  const css = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.equal(css.length, theme.axes.preset.ids.length * theme.axes.headings.ids.length);
});

test("renders the pilot's preview script byte for byte", () => {
  assert.equal(theme.previewScript(), golden("preview.js"));
});

test("reads the pilot's saved file as it is today: ids only, no changes", () => {
  const saved = { preset: "navy-gold", headings: "montserrat" };
  assert.deepEqual(theme.problems(saved), []);
  assert.equal(theme.css(theme.resolve(saved)), golden("navy-gold--montserrat.css"));
  assert.deepEqual(theme.store(saved), saved);
});

test("with nothing saved, renders the pilot's defaults", () => {
  assert.equal(theme.css(), golden("navy-gold--montserrat.css"));
  assert.equal(theme.css(theme.resolve(undefined)), golden("navy-gold--montserrat.css"));
});
