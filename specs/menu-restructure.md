---
status: draft
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

- [ ] AC1 — The main menu has, in this order: **▶ Extract** (first, green and
  bold, with the current URL or "no URL" as its hint, and where the cursor
  starts), **Extraction options**, **History**, **Settings**, **Quit**.
- [ ] AC2 — **History** is defined but hidden: it doesn't render until
  `extraction-history` enables it, and enabling it is a one-line change.
- [ ] AC3 — Extract with no URL set asks for it right there (with the recent
  URLs picker) and then extracts; cancelling that prompt goes back to the main
  menu without extracting.
- [ ] AC4 — **Extraction options** holds every option that exists today,
  grouped:
  - *Source*: URL, video limit.
  - *Output*: formats, columns, column order.
  - *Songs*: expand albums/mixes, long-video threshold, song order, exclude
    unavailable, remove duplicates, video type filter, genre filter.

  It's **one flat list**: the group names are rendered as disabled header rows
  (not selectable, the cursor skips them) with their options underneath. Each
  option keeps its current-value hint. The old "Extra options" submenu
  disappears (its entries move here).
- [ ] AC4b — The Extraction options entry on the main menu has **no** hint.
- [ ] AC5 — **Settings** holds Language (moved from the main menu). It's the
  place later specs add to (output folder, preferences, accessibility).
- [ ] AC6 — Cancelling (Ctrl+C/Esc) inside a submenu goes back one level; on
  the main menu it quits, same as today.
- [ ] AC7 — Nothing else changes: the config is still persisted on exit, the
  browser session is still reused across extractions, and quick mode is
  untouched.
- [ ] AC8 — The option lists of each menu are built by pure functions
  (config → options), unit-tested for: entry order, History hidden, and every
  option of AC4 present in its group.
- [ ] AC9 — The new layout works the same in every locale. (manual)

## Contract

- `cli.ts`: `mainMenuOptions(config)`, `extractionMenuOptions(config)`,
  `settingsMenuOptions()` exported for tests; a visibility flag for History.
- i18n keys in every locale: `menu.extractionOptions`, `menu.history`,
  `menu.settings` (+ submenu titles); obsolete keys (`menu.extra`,
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


## Tasks

<!-- To be written on approval. -->
