---
status: draft
target: v3.9.0
---

# Release pipeline: verifiable, immutable GitHub releases

## Why

Starting with `node-package` (v3.10) and `standalone-binary` (v3.11), people
will download and run artifacts built from this repo. Before that happens,
every release needs to be provably what it claims to be: the exact hash of
each file, proof of which workflow and commit built it, and a guarantee it
can't be swapped after publication.

The pipeline goes **first** because GitHub's immutable releases can't be
edited after publishing: checksums and attestations can't be added to a past
release later. Every artifact release must be born with them.

Release policy: **releases are immutable, always.** A mistake is fixed with a
new version, never by editing a published one. Testing happens with semver
pre-releases (`-alpha.N`, `-beta.N`, `-rc.N`), which are immutable too.

## Acceptance criteria

### Trigger & checks
- [ ] AC1 — Pushing a tag `vX.Y.Z` or `vX.Y.Z-<pre>.N` runs the release
  workflow; nothing else does.
- [ ] AC2 — The workflow fails, publishing nothing, if the tag doesn't match
  the `version` in `package.json`, or if `pnpm test`, `biome check` or
  `tsc --noEmit` fail.
- [ ] AC3 — A tag with a pre-release suffix is published as a GitHub
  **pre-release**; a plain `vX.Y.Z` as the latest release.

### Artifacts & integrity
- [ ] AC4 — Every release has at least one verifiable asset: a source archive
  produced by the workflow from the tagged commit (`git archive`). GitHub's
  automatic "Source code" zip/tarball can't be verified (they're generated on
  download), this one can. Later specs add their own assets (tarball, binaries)
  to the same flow.
- [ ] AC5 — A `SHA256SUMS` asset lists the SHA-256 of every other asset, in the
  format `sha256sum -c` understands. The same hashes appear in the release notes.
- [ ] AC6 — Every asset has a build provenance **artifact attestation**
  (`actions/attest`), verifiable with
  `gh attestation verify <file> -R ReinTristan/playlist-extractor`.

### Immutability
- [ ] AC7 — Immutable releases are enabled in the repository settings.
- [ ] AC8 — The workflow creates the release as a **draft**, uploads every
  asset, and only then publishes it (GitHub's recommended flow, so nothing is
  missing when it becomes immutable).
- [ ] AC9 — `gh release verify <tag>` and `gh release verify-asset <tag> <file>`
  pass for a published release. (manual)

### Workflow hygiene
- [ ] AC10 — Every third-party action is pinned to a full commit SHA (with the
  version as a comment), not a movable tag like `@v4`.
- [ ] AC11 — The workflow's `permissions` are the minimum needed
  (`contents: write`, `id-token: write`, `attestations: write`), and it uses no
  secrets beyond the built-in `GITHUB_TOKEN`.

### Notes & docs
- [ ] AC12 — Release notes are generated automatically, grouped by category
  (`.github/release.yml`), and link the spec(s) shipped in that version.
- [ ] AC13 — `RELEASING.md` documents the maintainer process step by step:
  bumping the version, cutting a pre-release, checking it, cutting the final
  release, and what to do when something goes wrong (new version, never edit).
- [ ] AC14 — The README has a "Verify your download" section for users:
  `sha256sum -c`, `gh attestation verify`, `gh release verify-asset`.
- [ ] AC15 — v3.9.0 itself ships through this pipeline, after at least one
  `-rc` pre-release run proves it end to end. (manual)

## Contract

- `.github/workflows/release.yml` and `.github/release.yml`.
- `RELEASING.md` at the repo root; README section.
- A documented extension point (a step or job) where `node-package` and
  `standalone-binary` add their assets, so they automatically get checksums
  and attestations.

## Out of scope

- Publishing to npm or any other registry.
- Building the package tarball or the binaries (their own specs).
- CI on pull requests / every push (a separate concern, though the release
  workflow reuses the same checks).

## Open questions

- **Signed tags** (GPG or SSH key), so the tag itself is verifiably yours? GitHub
  shows them as "Verified".
- `CHANGELOG.md` in the repo as well as the release notes, or just the notes?
- **SBOM attestation** (`actions/attest` with `sbom-path`, listing every
  dependency inside the artifact) in addition to build provenance?
- Manual tagging (`git tag` + `git push --tags`, suggested while learning) or
  automated versioning (e.g. release-please)?
- Should the source archive asset (AC4) stay after v3.10, once the package
  tarball exists, or is one source-like asset enough?

## Tasks

<!-- To be written on approval. -->
