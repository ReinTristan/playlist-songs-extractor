---
status: draft
target: v3.5.0
---

# CLI essentials: help, version, output dir, preferences, missing browser

## Why

Before the CLI becomes an installable package (`node-package`) and a binary
(`standalone-binary`), it has to feel like a complete command on its own:
`--help`/`--version` like any other tool, a choice of where the output goes
(a global command run from anywhere can't always write to `./output`), a way
to find and reset the saved preferences, and no crash when Chromium is missing.

Every option that changes behaviour must be reachable from **both** quick mode
and the interactive menu, not only from flags. In the menu they all go into
**Settings** (`menu-restructure`): none of them changes what gets extracted.

## Acceptance criteria

### Help & version
- [ ] AC1 — `--help`/`-h` prints the translated usage (positional args, every
  flag, `PLAYLIST_LANG`/`PLAYLIST_CONFIG_DIR`/`NO_COLOR`) and exits 0, without
  touching the network or opening a browser. It wins over any other argument.
- [ ] AC2 — `--version`/`-v` prints the version from `package.json` and exits 0.
- [ ] AC3 — The interactive menu shows the version in its intro banner.

### Output directory
- [ ] AC4 — `--out <dir>` (also `--out=<dir>`) writes the run folder inside
  `<dir>` instead of `./output`. Relative paths resolve against the current
  directory; the directory is created if it doesn't exist.
- [ ] AC5 — **Settings** has an "Output folder" entry showing the current
  value as its hint, edited with `@clack/prompts`' `path` prompt (directory
  autocompletion as you type). It's persisted as a setting (next to the locale, not
  inside the extraction options) and sanitized on read.
- [ ] AC6 — Without `--out` or a saved value, output still goes to `./output`.

### Preferences
- [ ] AC7 — `--config-path` prints the path of the preferences file and exits 0.
- [ ] AC8 — `--reset-config` deletes the saved preferences (locale, last config,
  recent URLs), prints a confirmation and exits 0.
- [ ] AC9 — **Settings** offers both: one entry shows the preferences path,
  the other resets them after a confirmation prompt. After a reset, the current
  session's config goes back to the defaults.
- [ ] AC10 — `NO_COLOR=1` disables colors (picocolors already honours it; this
  just gets documented in `--help` and the README).

### Missing Chromium
- [ ] AC11 — If Playwright's Chromium isn't installed, quick mode exits 1 with a
  translated message containing the install command, never Playwright's stack
  trace, and before attempting any navigation.
- [ ] AC12 — In the interactive menu the program doesn't crash or hang: the
  "Extract" entry is shown **disabled**, with a hint saying Chromium is missing
  and how to install it. Every other option keeps working. (manual)
- [ ] AC13 — The availability check doesn't launch the browser (it only checks
  that the executable exists), so it's cheap enough to run on every start.

## Contract

- Flags: `--help`/`-h`, `--version`/`-v`, `--out <dir>`, `--config-path`,
  `--reset-config`. `--out` joins `VALUE_FLAGS`, the rest are boolean. Short
  aliases need `parseFlags` to accept `-h`/`-v`.
- `ExtractConfig.outDir: string | null` (`null` = `./output`). Persisted as
  its own store key next to `locale`, not inside `lastConfig`, and sanitized
  (must be a non-empty string).
- `config.ts`: `resetConfig()` clears the store.
- `sources/scrape.ts`: `checkScrapeAvailability(): { ok: true } | { ok: false, reason }`,
  using `chromium.executablePath()` + an existence check. Shaped so that v4 can
  report a source as unavailable the same way (see `youtube-api-source`).
- Menu: "Output folder", "Preferences path" and "Reset preferences" entries
  in Settings; disabled "Extract" on the main menu when the scraper is unavailable
  (`@clack/prompts` 1.7 supports `disabled` on options).
- i18n keys in every locale: help text, version label, output-folder prompt and
  hint, config path/reset messages, reset confirmation, missing-browser message.

## Out of scope

- Installing Chromium automatically.
- A help screen inside the menu: the menu is already self-describing.
- Making the Playwright **package** optional (that's `node-package`).

## Open questions

- Should `--reset-config` ask for confirmation in quick mode too, or is
  passing the flag explicit enough? (Suggestion: no prompt, quick mode must stay
  scriptable.)

## Tasks

<!-- To be written on approval. -->
