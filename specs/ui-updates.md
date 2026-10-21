---
status: draft
target: v3.8.0
---

# UI updates

## Why

A release grouping the interface improvements that come after
`menu-restructure` and `accessibility-settings`: how the menus look and are
navigated, and how an extraction is shown while it runs and when it ends.
None of them changes what gets extracted.

Every part can be turned on or off from the Accessibility section of Settings
(created in `accessibility-settings`, v3.7), so nobody is forced into a UI
that doesn't work for their terminal, screen reader or taste.

## General criteria (apply to every part)

- [ ] G1 — Each part has its own toggle in Settings → Accessibility, with the
  default listed in its section. Toggles are persisted and reset with the rest
  of the preferences.
- [ ] G2 — With a part turned off, the UI behaves exactly as it did before
  this release.
- [ ] G3 — Parts respect the v3.7 accessibility settings: *no animations*
  replaces anything animated (progress bar, spinner) with static lines, *plain
  symbols* applies to anything drawn (boxes, bars), *colors off* applies everywhere.
- [ ] G4 — Quick mode is unaffected unless a part says otherwise.

## Part 1 — Extraction option groups as submenus (default: off)

- [ ] AC1.1 — When on, Extraction options shows one entry per group (Source,
  Output, Songs), each opening its own submenu. Esc goes back one level.
- [ ] AC1.2 — Both layouts render from the same group definition: a unit test
  checks that every option appears in both, in the same group.
- [ ] AC1.3 — The Preset entry (`extraction-presets`) stays at the top level
  of Extraction options in both layouts.

## Part 2 — Horizontal main menu (default: off)

<!-- Tentative until the feasibility spike. -->

- [ ] AC2.1 — The main menu renders on one line, moved with ←/→ (↑/↓ also
  work), Enter to pick, Esc/Ctrl+C to quit.
- [ ] AC2.2 — Disabled entries (e.g. Extract with no Chromium) are dimmed,
  skipped, and their reason is visible.
- [ ] AC2.3 — Too narrow a terminal falls back to the vertical menu.
- [ ] AC2.4 — Only the main menu goes horizontal; submenus stay vertical.
- [ ] AC2.5 — Same entries as the vertical menu (same `mainMenuOptions`).

## Part 3 — Progress bar during extraction (default: on)

- [ ] AC3.1 — Instead of one log line per step, extraction shows a progress
  bar per phase: reading the playlist, then reading tracklists ("Tracklists 2/5").
- [ ] AC3.2 — Warnings (a video whose description failed…) are still shown,
  not swallowed by the bar.
- [ ] AC3.3 — In quick mode without a TTY (piped output, CI), it falls back to
  plain lines automatically.

## Part 4 — Collapsing detail log (default: on)

- [ ] AC4.1 — Detailed progress messages are shown while the extraction runs
  and collapse when it ends successfully.
- [ ] AC4.2 — If the extraction fails, the log stays expanded.

## Part 5 — Summary box at the end (default: on)

- [ ] AC5.1 — A successful extraction ends with one box: videos, songs,
  expanded albums/mixes, warnings count, elapsed time and output folder.
- [ ] AC5.2 — Shown in quick mode too (it replaces the current final lines).

## Part 6 — Keyboard shortcuts in the main menu (default: on)

- [ ] AC6.1 — Each main-menu entry has a key (e.g. `e` Extract, `o` Options,
  `h` History, `s` Settings, `q` Quit), shown next to its label. Arrows + Enter
  keep working.
- [ ] AC6.2 — Keys are fixed, not translated, so muscle memory and docs work in
  every locale.
- [ ] AC6.3 — A disabled entry's key does nothing.

## Part 7 — Search as you type in long lists (default: on)

- [ ] AC7.1 — The columns picker, the recent URLs picker and the language
  picker filter as the user types.
- [ ] AC7.2 — When off, they're plain lists as today (better for some screen
  readers).

## Part 8 — Confirmation before extracting (default: off)

- [ ] AC8.1 — When on, Extract first shows a one-line summary ("120 videos →
  JSON, CSV · 7 columns · preset essential") with Extract / Change options.
- [ ] AC8.2 — Change options goes straight to Extraction options.

## Part 9 — Clickable links (default: on)

- [ ] AC9.1 — The output folder and URLs are printed as terminal hyperlinks
  (OSC 8), opened with Ctrl/Cmd+click where the terminal supports it.
- [ ] AC9.2 — Terminals without support show plain text, never escape garbage.
  Never used when output isn't a TTY.

## Part 10 — Move-mode column reordering (default: on)

- [ ] AC10.1 — In Column order, picking a column "grabs" it; ↑/↓ moves it live;
  Enter drops it; Esc cancels the move.
- [ ] AC10.2 — When off, the current select-column → up/down flow stays.

## Part 11 — Open the output folder automatically (default: off)

- [ ] AC11.1 — When on, the output folder opens in the system file manager
  after a successful extraction (interactive mode only).
- [ ] AC11.2 — Failing to open it is a warning, never an error.
- [ ] AC11.3 — Works on Linux, macOS, Windows and WSL. (manual)

## Contract

- Settings → Accessibility gets one toggle per part, persisted next to the
  other accessibility settings.
- The group definition from `menu-restructure` becomes data both Extraction
  options renderers read (Part 1).
- `runExtraction`'s `onProgress` grows from a plain message to structured
  events (phase, current, total, warning) so the CLI can drive a bar, a log or
  plain lines from the same source (Parts 3-5). The extractor stays UI-agnostic.
- `@clack/prompts` built-ins: `progress` (3), `taskLog` (4), `box`/`note` (5),
  `selectKey` (6), `autocomplete`/`autocompleteMultiselect` (7).
- Custom prompts on `@clack/core` (becomes a direct dependency) for Part 2 and
  Part 10: `Prompt`/`SelectPrompt` base with a custom `render()`, and
  `getColumns()` for the terminal width.
- i18n keys in every locale for each toggle and every new visible text.

## Out of scope

- Horizontal submenus; mouse support.
- Themes or custom color palettes.
- Choosing the output folder with a path prompt (that's `cli-essentials`).

## Open questions

- **Spike for the custom prompts (Parts 2 and 10):** does `@clack/core`'s
  `SelectPrompt` handle ←/→ out of the box? Does a custom render keep clack's
  look consistent with the other prompts?
- Horizontal menu: where do the hints go? A line under the bar showing the
  hint of the focused entry?
- Part 6 vs Part 7: `selectKey` and type-to-search can't share a list (typing
  `e` either jumps to Extract or starts a search). Shortcuts are only for the
  main menu and search only for long lists, so they shouldn't collide; confirm
  no list needs both.
- Part 9: auto-detect hyperlink support (there's no reliable standard way), or
  rely on the toggle alone?
- Part 11 on WSL: `xdg-open` usually doesn't reach Windows; opening with
  `explorer.exe` on the `wslpath -w` of the folder is the usual workaround.
  Detect WSL automatically?

## Tasks

<!-- To be written on approval, after the spike. -->
