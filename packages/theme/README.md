# @gravixar/theme

Design as data. A site lists its design choices as **axes of options** (colour presets, heading typefaces) and
this package renders them as CSS custom properties, with three rules built in:

- **Text below the contrast floor fails the build.** Every option is checked when the theme is defined.
- **A saved id that no longer exists falls back to the default.** Never rename an id once it may have been saved.
- **A client's choice is saved as a reference plus only what they changed**, so a later fix to a preset still
  reaches them.

It was extracted from a live bilingual site, and its tests prove it reproduces that site's CSS and preview script
byte for byte.

## Define

```ts
// src/lib/theme.ts
import { axis, defineTheme, tint } from "@gravixar/theme";

export const theme = defineTheme({
  axes: {
    preset: axis({
      options: {
        classic: { label: "Classic", tokens: { ink: "#14213D", paper: "#FFFFFF", accent: "#B8860B", text: "#1F2933" } },
        warm: { label: "Warm", tokens: { ink: "#2B1D14", paper: "#FBF7F0", accent: "#A0522D", text: "#2E2A26" } },
      },
      default: "classic",
      // Computed from the tokens, so they follow a client's changes.
      derive: (t) => ({ accentLine: tint(t.accent, 26) }),
      // Checked for every option now, and for a client's changes before they render or save. Default floor 4.5.
      contrast: { pairs: [["text", "paper"], ["paper", "ink"]] },
    }),
    headings: axis({
      options: {
        modern: { tokens: { display: 'var(--f-display), system-ui, sans-serif', hWeight: 300 }, lang: { ar: { display: 'var(--f-arabic), Tahoma, sans-serif', hWeight: 600 } } },
        classic: { tokens: { display: "Georgia, serif", hWeight: 500 } },
      },
      default: "modern",
    }),
  },
  preview: { keyPrefix: "site-" },
});
```

Tokens are camelCase and render kebab-case: `accentLine` becomes `--accent-line`. Options can carry any other data
(labels, notes); the package ignores it, so an editor can list the options straight from the same object.

## Render

In the root layout, read the saved choice and put the CSS and the preview script in `<head>`:

```tsx
const saved = readSavedTheme(); // e.g. content/theme.json, or {} when there is none

<html lang={locale} suppressHydrationWarning>
  <head>
    <style id="theme" dangerouslySetInnerHTML={{ __html: theme.css(saved) }} />
    <script dangerouslySetInnerHTML={{ __html: theme.previewScript() }} />
  </head>
```

`css()` renders the chosen options at `:root`, per-language values under `:root:lang(ar)`, then every option
under its attribute (`[data-preset="warm"]`), so a sample of any option can be shown side by side.

The preview script runs before first paint: `?preset=warm` previews that option for the rest of the visit
(sessionStorage, this tab only), `?preview=off` ends it, and unknown ids are ignored.

## Save

The saved file holds an id per axis and only the colours the client changed:

```json
{ "preset": "classic", "headings": "modern", "changes": { "accent": "#9A7209" } }
```

| Call | For | Behaviour |
|---|---|---|
| `theme.resolve(saved)` | rendering | Lenient. A missing or unknown id becomes the default; an invalid change is dropped. Never throws. |
| `theme.problems(saved)` | a test in CI | Everything `resolve()` corrected, plus any change that makes text unreadable. Assert it is `[]`. |
| `theme.store(selection)` | an editor saving | Strict. Returns the minimal form (unchanged values dropped) or throws a `ThemeError` listing every problem. |

Only `#RRGGBB` colours can be changed, and only tokens that are colours in every option. Derived tokens can't be
changed: they follow the tokens they come from. `css()` throws rather than render changes that break the floor,
so an unreadable save fails the deploy and the live site keeps its last good build.

## Tailwind v4

`theme.tailwind()` returns an `@theme inline` block that maps each colour token to utilities. Write it to a CSS
file imported after Tailwind:

```ts
writeFileSync("src/app/theme.css", theme.tailwind({ display: "--font-display" }));
```

```css
@import "tailwindcss";
@import "./theme.css";
```

The utilities read the runtime variables (`bg-accent` is `background-color: var(--accent)`), so presets, previews
and scoped samples keep working. Colour tokens are mapped automatically; map anything else by name.

## API

- `defineTheme({ axes, preview? })`: checks and compiles the theme. Throws a `ThemeError` listing every
  problem: an option below the floor, a contrast pair that isn't `#RRGGBB`, an option missing a token, an unknown
  default, a duplicated token, unsafe characters in a value. Copies the site's objects, so later changes to them
  have no effect.
- `axis(def)`: declares one axis with its token names checked in `default`, `derive` and `contrast`.
- `theme.axes.<axis>`: `{ ids, default, attribute, param, storageKey }` for editors and preview controls.
- `theme.resolve`, `theme.problems`, `theme.store`, `theme.css`, `theme.tailwind`, `theme.previewScript`: above.
- `contrast(a, b)`: the WCAG 2 ratio of two `#RRGGBB` colours. Throws on any other form rather than return `NaN`.
- `tint(color, percent)`: `color-mix(in srgb, <color> <percent>%, transparent)`.

## License

MIT
