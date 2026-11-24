# CLAUDE.md — gravixar-kit

The public `@gravixar/*` packages (MIT, published to npmjs.com): `forms`, `headers`, `theme`.
A pnpm workspace; each package lives in `packages/<name>`.

- **State:** project id `gravixar-kit` in the maintainer's own notes (see your user-level CLAUDE.md).
- **Check:** `pnpm check` (build, typecheck, test across the workspace). CI runs the same `check`
  job, and `main` only accepts pull requests that pass it.
- **Release:** an annotated tag `<package>-v<version>` (for example `forms-v0.2.1`, made with
  `git tag -a … -m …`) stages the release through npm trusted publishing. A maintainer approves
  it on npmjs.com before it goes public. Run `npm view @gravixar/<pkg>@<version>` before
  retrying an approval: it may already be public.
- **This repo is public.** No client names, private repo names, internal paths or audit detail
  in code, docs, commit messages or PR text. `git grep` the diff before committing.
- Commits use the GitHub noreply address set in this repo's git config. Keep it.
- Extract, never invent: a package exists because a live site already runs its code.
  This kit never imports private packages.
- No new docs, READMEs or summary files unless asked.
