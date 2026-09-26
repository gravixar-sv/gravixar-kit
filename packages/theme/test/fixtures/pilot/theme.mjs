// The pilot site's design options (Phase 0) in this package's shape: three colour presets, two heading sets,
// sixteen contrast pairs. options.json was generated from the site's own objects, and ./golden holds the CSS and
// preview script its original implementation rendered, which is also what its production pages serve.
import { readFileSync } from "node:fs";
import { axis, defineTheme, tint } from "../../../dist/index.js";

const data = JSON.parse(readFileSync(new URL("./options.json", import.meta.url), "utf8"));

export const theme = defineTheme({
  axes: {
    preset: axis({
      options: data.presets,
      default: data.defaults.preset,
      derive: (t) => ({
        gl: tint(t.gold, 26),
        gl2: tint(t.gold, 55),
        shadow: `0 18px 40px -24px ${tint(t.mid, 35)}`,
        shadowLg: `0 28px 60px -30px ${tint(t.mid, 45)}, 0 2px 6px -2px ${tint(t.mid, 8)}`,
      }),
      contrast: { pairs: data.contrastPairs },
    }),
    headings: axis({ options: data.headings, default: data.defaults.headings }),
  },
  preview: { keyPrefix: data.keyPrefix },
});
