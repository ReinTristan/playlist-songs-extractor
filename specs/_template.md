---
status: draft
---

# Feature name

## Why

<!-- 2-3 lines: the problem, not the solution. -->

## Acceptance criteria

<!--
Concrete, checkable statements: given this input/state → this observable result.
Each one maps to at least one test. Mark with (manual) the ones that can only be
verified by running against YouTube (anything inside src/sources/scrape.ts).
-->

- [ ] AC1 — …
- [ ] AC2 — …

## Contract

<!--
What changes at the boundaries: new/changed types and function signatures,
ExtractConfig fields (+ sanitizeConfig), quick-mode flags, menu entries,
i18n keys (they must exist in every locale).
-->

## Out of scope

<!-- What this spec deliberately does NOT do. -->

## Open questions

<!-- Must be empty before status: approved. -->

## Tasks

<!-- In commit-layer order. -->

- [ ] `locales/` — keys in every language
- [ ] `tests/` — one test per criterion (red)
- [ ] `src/` — following the import chain
- [ ] Docs — CLAUDE.md / README if usage or architecture changed
