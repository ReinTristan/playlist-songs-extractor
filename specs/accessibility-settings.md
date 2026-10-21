---
status: draft
target: v3.7.0
---

# Accessibility settings

## Why

The CLI relies on colors, unicode symbols and animated spinners. Some terminals
render them badly, and some users (screen readers, low contrast, plain logs)
are better served without them. These are settings in the "game settings"
sense of `menu-restructure`: they don't change what gets extracted.

The section keeps the name **Accessibility** even as later releases add
interface toggles to it (`ui-updates`): it's the foundation those build on,
not a misnomer.

## Acceptance criteria

<!-- Tentative until the open questions say what @clack/prompts supports. -->

- [ ] AC1 — **Settings** gets an Accessibility section with these options,
  persisted between sessions and resettable with the rest of the preferences.
- [ ] AC2 — *Colors off*: same effect as `NO_COLOR`, but saved. `NO_COLOR` in
  the environment still wins for a single run.
- [ ] AC3 — *Plain symbols*: ASCII instead of unicode symbols/box drawing.
- [ ] AC4 — *No animations*: spinners replaced by static progress lines.
- [ ] AC5 — Each one also has a quick-mode flag or env var, so a script can use
  them without the menu.
- [ ] AC6 — With all of them on, the whole flow (menu, extraction, errors) is
  still readable. (manual)

## Contract

- New persisted settings in `config.ts` (next to the locale, not inside the
  extraction options).
- i18n keys in every locale for the section and each option.

## Out of scope

- Themes or custom color palettes.
- Menu layout options (groups as submenus, horizontal main menu): they're in
  `ui-updates`; this spec only creates the Accessibility section they plug into.

## Open questions

- What does `@clack/prompts` actually let us control (symbols, spinners,
  colors)? Check before approving; anything it can't do either gets a
  workaround or leaves the spec.
- Any other accessibility need worth including (e.g. a verbose/quiet mode for
  the progress logs)?

## Tasks

<!-- To be written on approval. -->
