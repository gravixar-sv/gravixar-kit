import { test } from "node:test";
import assert from "node:assert/strict";
import { axis, contrast, defineTheme, ThemeError, tint } from "../dist/index.js";

const palettes = () => ({
  day: { label: "Day", tokens: { ink: "#1A1A1A", paper: "#FFFFFF", accent: "#0B5FFF", muted: "#5C5C5C" } },
  dusk: { label: "Dusk", tokens: { ink: "#F2F2F2", paper: "#121212", accent: "#7AA2FF", muted: "#A3A3A3" } },
});

const define = (options = palettes()) =>
  defineTheme({
    axes: {
      palette: axis({
        options,
        default: "day",
        derive: (t) => ({ wash: tint(t.accent, 12) }),
        contrast: { pairs: [["ink", "paper"], ["muted", "paper"]] },
      }),
      type: axis({
        options: {
          grotesk: { tokens: { display: '"Inter", sans-serif', weight: 600 }, lang: { ar: { display: '"IBM Plex Sans Arabic", sans-serif' } } },
          serif: { tokens: { display: "Georgia, serif", weight: 500 } },
        },
        default: "grotesk",
      }),
    },
  });

const theme = define();

/** Runs fn and returns the ThemeError it throws. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ThemeError, `expected a ThemeError, got ${error}`);
    return error;
  }
  assert.fail("expected a ThemeError");
}

// ── reading what a site saved ──────────────────────────────────────────────────────────────────────────

test("a missing or unknown id falls back to the default, and resolve never throws", () => {
  const defaults = { palette: "day", type: "grotesk", changes: {} };
  for (const saved of [undefined, null, "day", 42, [], {}, { palette: "night" }, { palette: 7, type: null }]) {
    assert.deepEqual({ ...theme.resolve(saved) }, defaults, JSON.stringify(saved));
  }
  assert.deepEqual({ ...theme.resolve({ palette: "dusk", type: "serif" }) }, { palette: "dusk", type: "serif", changes: {} });
});

test("problems() names every correction resolve() made silently", () => {
  assert.deepEqual(theme.problems({ palette: "dusk" }), []);
  assert.deepEqual(theme.problems(undefined), []);
  assert.deepEqual(theme.problems({ palette: "night", colour: "red" }), [
    'palette: "night" is not an option; using "day"',
    "colour: not an axis of this theme; ignored",
  ]);
  assert.deepEqual(theme.problems("day"), ['the saved choice is "day", not an object; using the defaults']);
});

test("resolve keeps valid colour changes and drops the rest", () => {
  const saved = { changes: { accent: "#0A4FD6", ink: "black", wash: "#FFFFFF", weight: "#FFFFFF", nope: "#FFFFFF" } };
  assert.deepEqual({ ...theme.resolve(saved).changes }, { accent: "#0A4FD6" });
  assert.deepEqual(theme.problems(saved), [
    'changes.ink: "black" is not a #RRGGBB colour; ignored',
    "changes.wash: computed from other tokens, so it follows them; ignored",
    "changes.weight: only colours can be changed; ignored",
    "changes.nope: not a token of this theme; ignored",
  ]);
});

// ── saving: a preset reference plus changed values only ────────────────────────────────────────────────

test("store keeps the ids and only the values that differ from the chosen option", () => {
  assert.deepEqual(theme.store({ palette: "day", type: "serif", changes: { ink: "#1a1a1a", accent: "#0A4FD6" } }), {
    palette: "day",
    type: "serif",
    changes: { accent: "#0A4FD6" },
  });
  assert.deepEqual(theme.store({ palette: "dusk", changes: { ink: "#F2F2F2" } }), { palette: "dusk", type: "grotesk" });
});

test("a fix to a preset still reaches a client who changed something else", () => {
  const saved = theme.store({ palette: "day", changes: { accent: "#0A4FD6" } });
  const fixed = palettes();
  fixed.day.tokens.ink = "#111111";
  const root = define(fixed).css(saved).split("\n")[0];
  assert.match(root, /--ink:#111111;/);
  assert.match(root, /--accent:#0A4FD6;/);
});

test("store refuses anything it can't save, and lists every problem", () => {
  const error = thrown(() =>
    theme.store({ palette: "night", changes: { muted: "#DDDDDD", wash: "#000000", display: "#000000", accent: "blue" } }),
  );
  assert.deepEqual(error.problems, [
    'palette: "night" is not an option; using "day"',
    "changes.wash: computed from other tokens, so it follows them; ignored",
    "changes.display: only colours can be changed; ignored",
    'changes.accent: "blue" is not a #RRGGBB colour; ignored',
    'palette "day" with the saved changes: muted on paper is 1.36:1, below the 4.5:1 contrast floor',
  ]);
});

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────────

test("the chosen options render at :root, and every option under its attribute", () => {
  assert.equal(
    theme.css({ palette: "dusk" }),
    [
      ':root{--ink:#F2F2F2;--paper:#121212;--accent:#7AA2FF;--muted:#A3A3A3;--wash:color-mix(in srgb, #7AA2FF 12%, transparent);--display:"Inter", sans-serif;--weight:600}',
      ':root:lang(ar){--display:"IBM Plex Sans Arabic", sans-serif}',
      '[data-palette="day"]{--ink:#1A1A1A;--paper:#FFFFFF;--accent:#0B5FFF;--muted:#5C5C5C;--wash:color-mix(in srgb, #0B5FFF 12%, transparent)}',
      '[data-palette="dusk"]{--ink:#F2F2F2;--paper:#121212;--accent:#7AA2FF;--muted:#A3A3A3;--wash:color-mix(in srgb, #7AA2FF 12%, transparent)}',
      '[data-type="grotesk"]{--display:"Inter", sans-serif;--weight:600}',
      '[data-type="grotesk"]:lang(ar){--display:"IBM Plex Sans Arabic", sans-serif}',
      '[data-type="serif"]{--display:Georgia, serif;--weight:500}',
    ].join("\n"),
  );
});

test("a :root:lang() rule appears only when the chosen option has values for that language", () => {
  assert.doesNotMatch(theme.css({ type: "serif" }), /^:root:lang/m);
  assert.match(theme.css({ type: "grotesk" }), /^:root:lang\(ar\)\{/m);
});

test("changes apply at :root only, and derived tokens follow them", () => {
  const [root, , day] = theme.css({ changes: { accent: "#0A4FD6" } }).split("\n");
  assert.match(root, /--accent:#0A4FD6;--muted:#5C5C5C;--wash:color-mix\(in srgb, #0A4FD6 12%, transparent\)/);
  assert.match(day, /^\[data-palette="day"\]\{.*--accent:#0B5FFF;/, "a preview of the preset shows the preset itself");
});

test("css refuses to render changes that make text unreadable", () => {
  const error = thrown(() => theme.css({ changes: { ink: "#EEEEEE" } }));
  assert.deepEqual(error.problems, ['palette "day" with the saved changes: ink on paper is 1.16:1, below the 4.5:1 contrast floor']);
});

// ── the definition fails the build when it's wrong ─────────────────────────────────────────────────────

test("a preset below the contrast floor fails at definition", () => {
  const options = palettes();
  options.day.tokens.muted = "#9A9A9A";
  const error = thrown(() => define(options));
  assert.deepEqual(error.problems, ['axis "palette", option "day": muted on paper is 2.81:1, below the 4.5:1 contrast floor']);
  assert.match(error.message, /^The theme can't be defined:\n {2}- axis "palette"/);
});

test("a contrast pair that isn't #RRGGBB fails instead of measuring NaN as a pass", () => {
  const options = palettes();
  options.day.tokens.muted = "#FFF";
  assert.deepEqual(thrown(() => define(options)).problems, [
    'axis "palette", option "day": contrast pair muted on paper needs #RRGGBB colours, got "#FFF" and "#FFFFFF"',
  ]);
});

test("every option sets the same tokens", () => {
  const options = palettes();
  delete options.dusk.tokens.muted;
  options.dusk.tokens.glow = "#FFFFFF";
  assert.deepEqual(thrown(() => define(options)).problems, [
    'axis "palette", option "dusk": missing muted; every option on an axis sets the same tokens',
    'axis "palette", option "dusk": sets glow, which the default option does not',
  ]);
});

test("unsafe or malformed definitions are refused, all at once", () => {
  const error = thrown(() =>
    defineTheme({
      axes: {
        changes: { options: { a: { tokens: { x: 1 } } }, default: "a" },
        tone: {
          options: { Loud: { tokens: { ink: "</style><script>", "bad-name": 1 } }, quiet: { tokens: { ink: "red", "bad-name": 2 } } },
          default: "loud",
          attribute: "tone",
        },
        size: { options: { s: { tokens: { x: 2 }, lang: { "not a tag": { x: 3 }, ar: { y: 4 } } } }, default: "s" },
      },
      preview: { keyPrefix: "a b" },
    }),
  );
  assert.deepEqual(error.problems, [
    'preview.keyPrefix "a b" may only use letters, digits, "-" and "_"',
    'axis "changes": an axis name is lower-case letters, digits and "-", and "changes" is reserved',
    'axis "tone": attribute "tone" must look like data-<name>',
    'axis "tone": option id "Loud" must be lower-case letters, digits and "-"',
    'axis "tone": the default "loud" is not one of its options',
    'axis "tone", option "Loud": ink is "</style><script>"; a value is a finite number, or text without "{", "}" or "<"',
    'axis "tone", option "Loud": token name "bad-name" must be camelCase letters and digits',
    'axis "tone", option "quiet": token name "bad-name" must be camelCase letters and digits',
    'axis "size", option "s": "not a tag" is not a language tag',
    'axis "size", option "s": lang.ar sets y, which the option itself does not',
    "token x is set by both axis \"changes\" and axis \"size\"",
  ]);
});

test("derive can't redefine a token, and two axes can't set the same token", () => {
  assert.deepEqual(
    thrown(() =>
      defineTheme({
        axes: {
          a: { options: { one: { tokens: { ink: "#000000" } } }, default: "one", derive: (t) => ({ ink: t.ink }) },
          b: { options: { two: { tokens: { ink: "#FFFFFF" } } }, default: "two" },
        },
      }),
    ).problems,
    ['axis "a": derive sets ink, which is already a token', 'token ink is set by both axis "a" and axis "b"'],
  );
  assert.deepEqual(thrown(() => defineTheme({ axes: {} })).problems, ["a theme needs at least one axis"]);
});

test("the site's objects are copied: changing them afterwards changes nothing", () => {
  const options = palettes();
  const copy = define(options);
  const before = copy.css();
  options.day.tokens.ink = "#000000";
  options.day.tokens.paper = "#000000";
  assert.equal(copy.css(), before);
});

test("the theme and its metadata are frozen", () => {
  assert.ok(Object.isFrozen(theme));
  assert.ok(Object.isFrozen(theme.axes) && Object.isFrozen(theme.axes.palette) && Object.isFrozen(theme.axes.palette.ids));
  assert.ok(Object.isFrozen(theme.resolve({})) && Object.isFrozen(theme.resolve({}).changes));
  assert.deepEqual({ ...theme.axes.palette }, {
    ids: ["day", "dusk"],
    default: "day",
    attribute: "data-palette",
    param: "palette",
    storageKey: "preview-palette",
  });
});

// ── contrast ───────────────────────────────────────────────────────────────────────────────────────────

test("contrast is the WCAG 2 ratio, and refuses anything but #RRGGBB", () => {
  assert.equal(contrast("#000000", "#FFFFFF").toFixed(2), "21.00");
  assert.equal(contrast("#FFFFFF", "#000000"), contrast("#000000", "#FFFFFF"));
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(contrast("#767676", "#FFFFFF").toFixed(2), "4.54");
  assert.throws(() => contrast("#FFF", "#000000"), TypeError);
  assert.throws(() => contrast("white", "#000000"), TypeError);
});
