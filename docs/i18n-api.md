# `@gravixar/i18n`: API draft

**Status: draft, not built.** Extracted from a live bilingual site (English and Arabic, one route prefix per
language, content edited side by side). A second live surface pairs English and Urdu without locale routes, and
is the comparison that decides what generalises.

## What the live site does

- **Paired strings.** Every piece of copy is `{ en, ar }`. Content files store pairs; slug collections store
  `title` plus `titleAr` and a loader re-pairs them. Lists are arrays of pairs.
- **Helpers:** `isLocale`, `dirOf` (rtl for Arabic), `otherLocale` (two locales, hard-coded), `tr(value, locale)`
  (no fallback), `num(value, locale)` (Arabic-Indic digits on Arabic pages), `href(locale, path)` → `/en/team`.
- **Metadata:** canonical per locale, `hreflang` for `en-AE`, `ar-AE` and `x-default` (English), Open Graph
  locale with alternates.
- **Routing:** a request proxy sends an unprefixed path to the cookie's language, else Arabic when
  `Accept-Language` starts with `ar`, else English, and remembers the language in `NEXT_LOCALE` once a prefixed
  page is visited.
- **Dates:** `Intl` with a pinned locale (`ar-AE-u-nu-arab`, `en-GB`) and a pinned time zone. On the second
  surface, an unpinned locale rendered "14 Aug" on the server and "Aug 14" in Chrome, a hydration mismatch.
- **Missing translations:** `tr` renders an empty Arabic string silently. On the live site, 15 of 296 pairs are
  empty on both sides (treated as absent) and none are half-filled, a state nothing enforces today.

## Shape

One framework-free entry, and one for Next.js:

- `@gravixar/i18n`: the locale set, text pairs, digits, dates, and completeness checks.
- `@gravixar/i18n/next`: metadata alternates and the locale proxy.

```ts
// src/i18n.ts
import { defineLocales, type LocaleOf, type TextOf } from "@gravixar/i18n";

export const i18n = defineLocales({
  locales: ["en", "ar"],
  default: "en",
  rtl: ["ar"],
  regions: { en: "en-AE", ar: "ar-AE" },     // hreflang and Open Graph
  digits: { ar: "arab" },                     // Arabic-Indic digits in num() and dates
  timeZone: "Asia/Dubai",                     // pinned, never the runtime's
});

export type Locale = LocaleOf<typeof i18n>;   // "en" | "ar"
export type Text = TextOf<typeof i18n>;       // { en: string; ar: string }
```

## API

### `defineLocales(config)`

```ts
interface LocaleConfig<L extends string> {
  locales: readonly L[];
  default: L;
  rtl?: readonly L[];
  regions?: Partial<Record<L, string>>;
  digits?: Partial<Record<L, "arab" | "arabext" | "latn">>;
  timeZone: string;                                   // required: an unpinned zone renders differently per runtime
}
```

Returns a frozen object:

| Member | From the live site | Notes |
|---|---|---|
| `isLocale(value): value is L` | as is | |
| `dir(locale): "rtl" \| "ltr"` | `dirOf` | |
| `others(locale): L[]` | `otherLocale` | generalised from two locales to any number |
| `href(locale, path?)` | as is | `/ar/team`; the default locale keeps its prefix, as live |
| `t(value, locale)` | `tr` | returns the string; a blank one is reported by `missing()`, never replaced by another language |
| `num(value, locale)` | as is | digits only, so phone numbers can stay Latin |
| `date(iso, locale, style?)` | `formatDate` | `Intl.DateTimeFormat` with the pinned zone and the numbering system from `digits` |
| `pair(flat, field)` | the loaders | `{ title, titleAr }` → `{ en, ar }` for slug collections |
| `missing(value)` | new | the locales whose side of a pair is blank |
| `audit(content)` | new | walks any JSON value and lists every half-filled pair with its path. **Fails the build** when one is found. |

### Why `audit` is new

A partly translated page is worse than an untranslated one: a live app once shipped English laid out right to
left. The live site has no half-filled pairs today, and nothing keeps it that way. `audit` makes the build fail
on the first one, the way `@gravixar/theme` fails on an unreadable colour. A pair that is empty on both sides stays
allowed: it means "not written yet", and pages already treat it as absent (`filled()` today).

### `@gravixar/i18n/next`

```ts
alternates(i18n, path, baseUrl): Metadata["alternates"];     // canonical + languages, with x-default → default
openGraphLocale(i18n, locale): { locale: string; alternateLocale: string[] };
localeProxy(i18n, { cookie?: "NEXT_LOCALE" }): (request: NextRequest) => NextResponse | undefined;
```

`localeProxy` keeps the live behaviour (cookie first, then the browser's language, else the default) with one
fix: it picks the supported locale with the highest q-value, not just the first entry. Today a browser whose first
language isn't supported, `fr-FR,ar;q=0.9,en;q=0.8`, goes to English. With q-values it goes to Arabic, the
reader's next choice.

## Not in v0

- **Editor field helpers.** The live site's Keystatic `bi(label)` helper, which puts English and Arabic side by side
  in one row, is proven on one editor only. The Phase 2 editor (Payload) localises fields itself. Generalise the
  helper if a second Keystatic site needs it.
- **Message catalogues and plurals.** No live site uses ICU messages. Pairs cover every string today.
- **Locale detection without routes.** The second surface stores the choice in `localStorage` and sets
  `dir="auto"` per element. That shape joins when a second site needs it.

## Open questions

1. **Text type for more than two locales.** `{ en, ar }` pairs are exact for bilingual sites. A third locale makes
   every pair a record that can be incomplete. Should `Text` then be `Record<L, string>` with `audit` doing the
   enforcement? That is the draft's assumption.
2. **The default locale's prefix.** Live routing keeps `/en`. Some sites will want the default at `/`. It is a
   one-line option, but it changes canonical URLs, so it needs a decision per site.
