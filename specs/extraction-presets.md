---
status: draft
target: v3.4.0
---

# Extraction presets

## Why

Setting up columns, formats and song options one by one is the slow part of
the menu, and most runs fall into a few recurring shapes ("just artist and
song", "everything", "expand the albums"). Presets apply one of those shapes
in a single step, and custom presets let the user save their own: what today
only exists implicitly as "the last config used".

## Acceptance criteria

- [ ] AC1 — Built-in presets exist: `minimal`, `essential`, `album`, `full`.
  Their contents are fixed in `types.ts`.
- [ ] AC2 — **Extraction options** gets a "Preset" entry at the top of the
  list; applying one replaces the options it covers and leaves the rest alone
  (URL and video limit are never touched).
- [ ] AC3 — After applying a preset and then changing any option, the hint
  shows it as modified (e.g. "essential (modified)"), so the user knows the
  current state no longer matches the preset.
- [ ] AC4 — The current options can be saved as a **custom preset** with a
  name; custom presets can be applied, overwritten and deleted. Their names
  can't collide with built-in ones.
- [ ] AC5 — Custom presets survive restarts and are sanitized on read like the
  last config: a preset saved by an older version with a column that no longer
  exists still applies (without that column), and an unusable one is dropped.
- [ ] AC6 — Quick mode: `--preset <name>` applies a built-in or custom preset;
  any other flag on the same command overrides it (`--preset=minimal
  --formats=csv`). An unknown name exits 1 listing the available presets.
- [ ] AC7 — Built-in preset labels are translated; their keys stay canonical
  (`essential`, not "esencial") so a `--preset` in a script works in any
  locale. Custom preset names are shown as typed.
- [ ] AC8 — The "last config" auto-save keeps working exactly as today:
  presets are an addition, not a replacement.

## Contract

- `types.ts`: `PRESETS` (built-in name → partial extraction options); no
  visible text, labels come from `locales/` (`presets.<name>`).
- A pure `applyPreset(config, preset)` function, unit-tested.
- `config.ts`: custom presets read/save/delete, with sanitization.
- `parseFlags`/`applyFlags`: `--preset`, applied **before** the other flags.
- i18n keys in every locale: built-in labels, the Preset entry, save/delete
  prompts, "(modified)", the unknown-preset error.

## Out of scope

- Importing/exporting presets to files.
- A `stats` preset: there are no stats columns yet (views, likes, publish
  date…). It comes after the API source (`youtube-api-source`, v4) adds them.
- Presets for Settings (output folder, language…): presets are only about what
  gets extracted.

## Open questions

- **What does a preset cover?** Only the *Output* group (formats, columns,
  column order), or *Output* + *Songs* (expand, threshold, order, filters…)?
  (Suggestion: both; "album" doesn't make sense without touching expand/filters.)
- **Contents of each built-in.** First proposal:
  - `minimal`: position, artists, songTitle.
  - `essential`: position, artists, featuredArtists, songTitle, mixType,
    genres, duration.
  - `album`: expand on; position, artists, songTitle, parentVideoId,
    startTimestamp, duration.
  - `full`: every column, every format, default song options.
- Does "last used config" show up in the preset list as a pseudo-preset, or
  stay invisible as it is now?

## Tasks

<!-- To be written on approval. -->
