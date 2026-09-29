# Gravixar kit

The public, client-facing packages under every site Gravixar builds. They are MIT-licensed and published to npm
without a token, so a client who leaves keeps the code and their site keeps building.

| Package | Status |
|---|---|
| [`@gravixar/theme`](packages/theme) | 0.1.0. Design as data: presets rendered as CSS variables, a contrast floor that fails the build, a no-flash preview script, a Tailwind v4 `@theme` block. |
| [`@gravixar/forms`](packages/forms) | 0.1.0, not yet published. Form submissions for server actions: a bot gate before validation, any Standard Schema validator, stable ids, delivery that fails closed in production. |
| [`@gravixar/headers`](packages/headers) | 0.1.0, not yet published. Security headers for a Next.js `headers()` entry: a strict default (HSTS, CSP, a deny-all Permissions-Policy) that a site overrides one slice at a time. |
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

Changes reach `main` through pull requests, and CI must pass before one merges.

## Release

Bump `version` in the package's `package.json` through a pull request, merge it, then push a tag named for the
package and version:

```sh
git tag theme-v0.1.1
git push origin theme-v0.1.1
```

A package's first version is published by hand, because npm configures a trusted publisher from an existing
package's settings. Tags then stage every later version.

The publish workflow checks the tag matches the version, runs the full check, and stages the version through npm
trusted publishing, so no npm token is stored anywhere. A staged version isn't public: a maintainer approves it with
two-factor authentication on npmjs.com (Staged Packages → Approve), or with `npm stage approve <stage-id>`. CI can
never publish on its own.

## License

[MIT](LICENSE)
