# Gravixar kit

The public, client-facing packages under every site Gravixar builds. They are MIT-licensed and published to npm
without a token, so a client who leaves keeps the code and their site keeps building.

| Package | Status |
|---|---|
| [`@gravixar/theme`](packages/theme) | 0.1.0. Design as data: presets rendered as CSS variables, a contrast floor that fails the build, a no-flash preview script, a Tailwind v4 `@theme` block. |
| `@gravixar/forms` | API draft: [docs/forms-api.md](docs/forms-api.md). Not built yet. |
| `@gravixar/i18n` | API draft: [docs/i18n-api.md](docs/i18n-api.md). Not built yet. |

## Rules

- **Extract, never invent.** A package starts as code already running on a live site, and generalises on its
  second use. Tests prove an extraction reproduces the original.
- **Used or cut.** Anything no client site uses within 60 days of release is removed.
- **No token on the build path.** Nothing here depends on a private package or registry.
- **Fail loudly.** A mistake a site could ship (an unreadable colour, an option missing a value) fails the
  site's build, never a page.

## Develop

```sh
pnpm install
pnpm check   # build, typecheck the published declarations, test
```

## License

[MIT](LICENSE)
