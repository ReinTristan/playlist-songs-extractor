---
status: approved
target: v3.3.0
---

# Menu restructure: a short main menu, everything else in submenus

## Why

The main menu has 10 entries mixing what gets extracted (formats, columns…),
how the program behaves (language) and the actions themselves (extract, quit),
plus a separate "extra options" submenu with no clear boundary. Upcoming specs
(`cli-essentials`, `extraction-history`, `accessibility-settings`) add more
entries, so the structure has to be settled first.

**The rule** (like an online game's match settings vs game settings):

- **Extraction options** = the match settings: anything that changes **what**
  ends up in the result.
- **Settings** = the game settings: how the program behaves for the user,
  regardless of which playlist is extracted. Includes *where* output goes.

Being remembered between runs doesn't make something a setting: extraction
options are persisted too. What decides is whether it changes the result.

## Acceptance criteria

- [x] AC1 — The main menu has, in this order: **▶ Extract** (first, green and
  bold, with the current URL or "no URL" as its hint, and where the cursor
  starts), **Extraction options**, **History**, **Settings**, **Quit**.
- [x] AC2 — **History** is defined but hidden: it doesn't render until
  `extraction-history` enables it, and enabling it is a one-line change.
- [x] AC3 — Extract with no URL set asks for it right there (with the recent
  URLs picker) and then extracts; cancelling that prompt goes back to the main
  menu without extracting.
- [x] AC4 — **Extraction options** holds every option that exists today,
  grouped:
  - *Source*: URL, video limit.
  - *Output*: formats, columns, column order.
  - *Songs*: expand albums/mixes, long-video threshold, song order, exclude
    unavailable, remove duplicates, video type filter, genre filter.

  It's **one flat list**: the group names are rendered as disabled header rows
  decorated as `── Source ──` (not selectable, the cursor skips them; clack draws
  disabled rows with the same `○` as regular ones, so the name alone would barely
  stand out) with their options underneath. Each option keeps its current-value
  hint. The old "Extra options" submenu disappears (its entries move here).
- [x] AC4b — The Extraction options entry on the main menu has **no** hint.
- [x] AC4c — After editing an option, the Extraction options cursor stays on that
  option instead of jumping back to the top: with 12 options in one list, changing
  several in a row would otherwise mean walking down every time. (manual)
- [x] AC5 — **Settings** holds Language (moved from the main menu). It's the
  place later specs add to (output folder, preferences, accessibility).
- [x] AC6 — Cancelling (Ctrl+C/Esc) inside a submenu goes back one level; on
  the main menu it quits, same as today. (manual)
- [x] AC7 — Nothing else changes: the config is still persisted on exit, the
  browser session is still reused across extractions, and quick mode is
  untouched.
- [x] AC8 — The option lists of each menu are built by pure functions
  (config → options), unit-tested for: entry order, History hidden, and every
  option of AC4 present in its group.
- [x] AC9 — The new layout works the same in every locale. (manual)

## Contract

- `types.ts`: `EXTRACTION_GROUPS` (group key → option keys, no visible text) and
  the `ExtractionOption` type.
- `cli.ts`: `mainMenuOptions(config)`, `extractionMenuOptions(config)`,
  `settingsMenuOptions()` and `ensureUrl(config, ask)` exported for tests; a
  visibility flag for History.
- i18n keys in every locale: `menu.extractionOptions`, `menu.history`,
  `menu.settings`, `menu.groups.*`, `menu.<option>` for each option,
  `hints.noUrl` (+ submenu titles); obsolete keys (`menu.extra`,
  `prompts.extra*`…) removed or moved, with `tests/i18n.test.ts` still green.
- README: the interactive-mode section describes the new layout.

## Out of scope

- New options of any kind: this spec only moves existing ones.
- The history itself (`extraction-history`).
- Showing each group as its own submenu: that's an opt-in accessibility
  setting (`ui-updates`). The group definition from AC4 is what
  both layouts render from.
- Output folder, preferences and accessibility entries in Settings
  (`cli-essentials`, `accessibility-settings`).

## Open questions


## Bug fixes shipped in this version

Fixes that ride along with this release instead of waiting for their own patch.
They don't change the menu; they're listed here so the release notes for v3.3.0
have a single place to come from.

- [x] **Collaboration channels glued together** (`Sunnexoand EX-LYD` instead of
  `Sunnexo; EX-LYD`). YouTube now renders each name in the metadata row as its
  own `<span>`, with the gap between them coming from CSS, not text; reading the
  row's `textContent` joined them with no space, so `resolveChannelNames` had no
  standalone `and` to split on. `sources/scrape.ts` now reads each
  `YT_SELECTORS.metadataText` span and joins them with a space (falling back to
  the whole row's text if there are none), so the source still hands over raw
  text and the splitting stays in `resolveChannelNames`. (manual: verified with a
  full extraction of the Daily songs playlist, ~30 collaboration videos)
  - Known limitation, deliberately left as is: with 3+ channels YouTube only shows
    `First and N more`, which becomes `First; N more`. The full list isn't in the
    playlist DOM; it comes complete with the YouTube Data API source (v4,
    `youtube-api-source`), so no extra scraping is added for it.
- [x] **Clack's own texts stayed in English** in every locale: the `Yes / No` of
  every confirm (the first-run language question included) and the key-help
  footers (`↑/↓ to navigate • Space: select • Enter: confirm`). Clack only lets
  Yes/No be set per call, so `cli.ts` wraps `p.confirm` in a `confirm` helper
  that always passes `prompts.yes`/`prompts.no`; the first-run question takes
  them from `firstRun.yes`/`no` in `meta.json`, since it renders before any
  `translation.json` is loaded. There's no option for the footers, but clack
  exports the arrays it reads on every render, so `localizeClack` in `i18n.ts`
  rewrites `SELECT_INSTRUCTIONS`/`MULTISELECT_INSTRUCTIONS` **in place** (clack
  keeps the reference) from `initI18n` and `changeLocale`, which covers switching
  language from Settings too. Tests in `tests/i18n.test.ts` check the English text
  stays identical to clack's and that es/fr rewrite it, so a clack update that
  stops reading those arrays fails there. (manual: verified in a pty in en/es/fr,
  plus a live language switch)
  - Known limitation, deliberately left as is: deselecting everything in a
    multiselect shows clack's `Please select at least one option…` in English.
    It's hardcoded in clack's own `validate` with no override; working around it
    (`required: false` + validating by hand) would flash clack's English `none`
    before the translated warning, and the prompt still blocks the empty submit.

## Tasks

- [x] `locales/` — new, moved and removed keys in every language
- [x] `tests/` — `menu.test.ts` (AC1-AC5, AC8), `i18n.test.ts` coverage (AC9)
- [x] `src/types.ts` — `EXTRACTION_GROUPS`
- [x] `src/cli.ts` — option builders, submenus, `ensureUrl`
- [x] Manual run in a pty, in every locale (AC4c, AC6, AC9)
- [x] Real extraction, twice in one session (AC7: browser reuse)
- [ ] Docs — README, CLAUDE.md, `specs/decisions.md`
- [ ] `package.json` → 3.3.0
