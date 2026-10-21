---
status: draft
target: v3.10.0
---

# Transpile to JavaScript and make it an installable Node package

## Why

The project only runs as TypeScript source on Node 24+/Bun from a checkout. It
should also be a regular Node package: transpiled to plain JS, installable with
npm/pnpm (including globally, as a `playlist-extractor` command) straight from
GitHub or a tarball. Publishing to the npm registry is **not** the goal.

## Acceptance criteria

- [ ] AC1 — `pnpm build` transpiles `src/` to plain JS in `dist/` (gitignored);
  the built CLI runs with `node dist/index.js` and behaves like `node src/index.ts`.
- [ ] AC2 — `pnpm add -g github:ReinTristan/playlist-extractor` (and the npm
  equivalent) installs a working global `playlist-extractor` command; the build
  runs automatically on install from git. (manual)
- [ ] AC3 — `pnpm pack` produces a tarball that installs the same way, containing
  only what's needed to run (`dist/`, `locales/`, README, LICENSE).
- [ ] AC4 — The installed command finds `locales/` and reads its version
  regardless of the directory it's run from.
- [ ] AC5 — The package installs and starts **without Playwright**: Playwright
  is loaded with a dynamic `import()` only when the scraper is used, so a missing
  package is reported like a missing Chromium (see `cli-essentials`), as an
  unavailable source rather than a crash at import time.
- [ ] AC6 — The dev workflow is unchanged: `node src/index.ts`,
  `bun src/index.ts` and `pnpm test` work without building.
- [ ] AC6b — The `pnpm pack` tarball is built by the release workflow
  (`release-pipeline`) and attached to every release from v3.10 on, with its
  SHA-256 in `SHA256SUMS` and its own artifact attestation. Installing from the
  release asset is documented next to installing from GitHub.
- [ ] AC7 — README documents installing, updating and uninstalling the command
  (from GitHub, from a tarball, and `pnpm link --global` for local development).

## Contract

- `package.json`: `bin`, `files`, `engines`, `build` and `prepare` scripts.
- `tsconfig`: a build config that emits to `dist/` (the current one stays
  `noEmit` for type-checking), rewriting the `.ts` import extensions to `.js`.
- Playwright moves from a static import to a dynamic one inside
  `sources/scrape.ts`.

## Out of scope

- Publishing to the npm registry.
- A standalone executable (that's `standalone-binary`).
- Bundling/minifying: plain per-file transpilation is enough here.

## Open questions

- Minimum Node version for the built package: with JS output it no longer needs
  24+. Which one do we promise (and test)?
- Playwright as a regular dependency, `optionalDependencies` or
  `peerDependencies` (+ `peerDependenciesMeta.optional`)? Affects whether a
  plain install pulls it in.
- CLI only, or also export a programmatic API (`runExtraction`, `parseTitle`…)
  through `exports`?
- Emit with `tsc` (TypeScript 7 is already a dev dependency) or a separate
  transpiler?

## Tasks

<!-- To be written on approval. -->
