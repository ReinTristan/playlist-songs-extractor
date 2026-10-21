# Specs

Lightweight spec-driven development: every feature (or deliberate non-feature)
gets a short spec here **before** any test or code is written.

## Flow

1. **Draft:** copy `_template.md` to `short-kebab-name.md` and fill it in.
   `status: draft`. Specs are not numbered on purpose: the order they get
   implemented in is decided when picking the next one, not when writing them.
2. **Approve:** read it, fix it, resolve every open question. Only then
   `status: approved`. **No tests or code before this point.**
3. **Tests:** each acceptance criterion becomes one or more tests in `tests/`,
   red on purpose (spec-first, same as the TDD we already do).
4. **Implement** until green, ticking off the tasks. Update `CLAUDE.md`/README
   if the architecture or usage changed, then `status: done`.

## Statuses

| Status | Meaning |
| --- | --- |
| `draft` | Being written; may still have open questions |
| `approved` | Agreed; open questions empty; tests may be written |
| `done` | Implemented, all criteria met (add the version/tag it shipped in) |
| `discarded` | Evaluated and deliberately rejected; kept for the *why* |

Discarded specs are never deleted: the reasoning behind a "no" is what stops
the same idea from being re-evaluated from scratch a year later.

## Index

| Spec | Status |
| --- | --- |
| [Menu restructure: a short main menu, everything else in submenus](menu-restructure.md) | draft (v3.3) |
| [Extraction presets](extraction-presets.md) | draft (v3.4) |
| [CLI essentials: help, version, output dir, preferences, missing browser](cli-essentials.md) | draft (v3.5) |
| [Extraction history](extraction-history.md) | draft (v3.6) |
| [Accessibility settings](accessibility-settings.md) | draft (v3.7) |
| [UI updates: menu layouts, extraction progress, navigation, small touches](ui-updates.md) | draft (v3.8) |
| [Release pipeline: verifiable, immutable GitHub releases](release-pipeline.md) | draft (v3.9) |
| [Transpile to JavaScript and make it an installable Node package](node-package.md) | draft (v3.10) |
| [Standalone binary, with more than one way to build it](standalone-binary.md) | draft (v3.11) |
| [YouTube Data API v3 as a second source](youtube-api-source.md) | draft (v4) |
| [Split the source layer out of the extractor](source-layer-split.md) | done (v3.2.0) |
| [Extended mode: open every video for more data](extended-mode.md) | discarded |
