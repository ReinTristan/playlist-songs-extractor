---
status: draft
target: v3.11.0
---

# Standalone binary, with more than one way to build it

## Why

A single executable that runs without Node or a checkout. Since anyone cloning
the repo may prefer a different toolchain, the build should be possible with
more than one runtime, as long as each one actually works.

## Acceptance criteria

- [ ] AC1 — Each supported toolchain has its own script
  (`pnpm build:bin:<runtime>`) producing one executable in a gitignored folder.
- [ ] AC2 — The executable runs both modes from any directory, with translations
  embedded (no `locales/` folder needed next to it). (manual)
- [ ] AC3 — Chromium stays a separate install; a missing browser (or Playwright
  failing inside the binary) is reported as an unavailable source, never a crash
  (same behaviour as `cli-essentials`).
- [ ] AC4 — A real extraction through each executable matches
  `node src/index.ts`. (manual)
- [ ] AC4b — The release workflow (`release-pipeline`) builds the binaries of
  every supported toolchain and attaches them to the release, each with its
  SHA-256 in `SHA256SUMS` and its own artifact attestation. Asset names say
  toolchain, OS and architecture (e.g. `playlist-extractor-bun-linux-x64`).
- [ ] AC5 — README has a table of the supported toolchains, how to build with
  each, and the ones evaluated and rejected, with the reason.

## Contract

- `package.json`: one `build:bin:<runtime>` script per supported toolchain.
- Whatever each toolchain needs to embed `locales/` and the version.

## Out of scope

- Bundling Chromium into the executable.

## Open questions

- Which toolchains actually work with Playwright inside a binary? Candidates,
  each to be checked with a spike before approving:
  - **Bun**: `bun build --compile` + `--asset ./locales` (the installed Bun 1.3.6
    may be too old for `--asset`).
  - **Node SEA** (Single Executable Applications): needs a single bundled file
    first (esbuild/rolldown) and an assets config.
  - **Deno**: `deno compile` with `--include locales`.
  Playwright spawns its own driver and loads files dynamically, which is the
  usual breaking point for all of them.
- Which OS/architectures get binaries in the release (a runner matrix:
  linux-x64, macOS arm64, windows-x64…), or cross-compile from one runner
  where the toolchain supports it?
- Does it build on top of `node-package`'s `dist/` output, or straight from
  `src/`?

## Tasks

<!-- To be written on approval, after the spikes. -->
