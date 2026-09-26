import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "tailwindcss";
import { defineTheme, ThemeError, tint } from "../dist/index.js";

const theme = defineTheme({
  axes: {
    palette: {
      options: {
        day: { tokens: { ink: "#1A1A1A", paper: "#FFFFFF", accentSoft: "#6B8CFF" } },
        dusk: { tokens: { ink: "#F2F2F2", paper: "#121212", accentSoft: "#9DB4FF" } },
      },
      default: "day",
      derive: (t) => ({ wash: tint(t.accentSoft, 12) }),
    },
    type: { options: { sans: { tokens: { display: "system-ui, sans-serif" } } }, default: "sans" },
  },
});

test("maps every colour token to a utility that reads the runtime variable", () => {
  assert.equal(
    theme.tailwind(),
    "@theme inline {\n  --color-ink: var(--ink);\n  --color-paper: var(--paper);\n  --color-accent-soft: var(--accent-soft);\n}\n",
  );
});

test("maps other tokens by name", () => {
  assert.match(theme.tailwind({ display: "--font-display", wash: "--color-wash" }), /  --font-display: var\(--display\);\n  --color-wash: var\(--wash\);\n\}\n$/);
});

test("refuses an unknown token or a malformed variable name", () => {
  assert.throws(() => theme.tailwind({ nope: "--font-x", display: "font-display" }), (error) => {
    assert.ok(error instanceof ThemeError);
    assert.deepEqual(error.problems, ["nope: not a token of this theme", 'display: "font-display" is not a variable name like --font-display']);
    return true;
  });
});

test("compiles with Tailwind v4 into utilities that follow presets and previews", async () => {
  const compiler = await compile(`${theme.tailwind({ display: "--font-display" })}\n@tailwind utilities;`);
  const css = compiler.build(["bg-paper", "text-ink", "border-accent-soft", "font-display"]);
  assert.match(css, /\.bg-paper\s*\{\s*background-color:\s*var\(--paper\);?\s*\}/);
  assert.match(css, /\.text-ink\s*\{\s*color:\s*var\(--ink\);?\s*\}/);
  assert.match(css, /\.border-accent-soft\s*\{[^}]*border-color:\s*var\(--accent-soft\);?[^}]*\}/);
  assert.match(css, /\.font-display\s*\{\s*font-family:\s*var\(--display\);?\s*\}/);
  assert.doesNotMatch(css, /--color-paper/, "inline: no intermediate variable, so a scoped preset reaches the utility");
});
