// Checked by `pnpm typecheck` against the built declarations, as a consumer sees them. Each @ts-expect-error is a
// negative test: if the types stop rejecting that line, the directive goes unused and the typecheck fails.
import { axis, defineTheme, tint, type Choice } from "../dist/index.js";

const palette = axis({
  options: {
    day: { label: "Day", tokens: { ink: "#111111", paper: "#FFFFFF" } },
    dusk: { label: "Dusk", tokens: { ink: "#EEEEEE", paper: "#111111" } },
  },
  default: "day",
  derive: (t) => ({ wash: tint(t.ink, 10) }),
  contrast: { pairs: [["ink", "paper"]] },
});

const theme = defineTheme({ axes: { palette }, preview: { keyPrefix: "demo-" } });

const ids: readonly ("day" | "dusk")[] = theme.axes.palette.ids;
const chosen: "day" | "dusk" = theme.resolve({}).palette;
const choice: Choice<{ palette: typeof palette }> = theme.resolve({ palette: "dusk" });
const css: string = theme.css({ palette: "dusk", changes: { ink: "#000000" } }) + theme.css(choice) + theme.css();
const saved = theme.store({ palette: "day" });
const savedId: string | undefined = saved.palette;
void [ids, chosen, css, savedId];

axis({
  options: { a: { tokens: { ink: "#111111" } } },
  // @ts-expect-error the default must be one of the options
  default: "b",
});

axis({
  options: { a: { tokens: { ink: "#111111", paper: "#FFFFFF" } } },
  default: "a",
  // @ts-expect-error a contrast pair names the axis's own tokens
  contrast: { pairs: [["ink", "papr"]] },
});

axis({
  options: { a: { tokens: { ink: "#111111" } } },
  default: "a",
  // @ts-expect-error derive sees only the axis's own tokens
  derive: (t) => ({ wash: tint(t.missing, 10) }),
});

// @ts-expect-error a resolved choice only holds real ids
const wrong: "night" = theme.resolve({}).palette;
void wrong;

// @ts-expect-error the saved choice is keyed by axis
theme.store({ palette: "day", changes: "#000000" });
