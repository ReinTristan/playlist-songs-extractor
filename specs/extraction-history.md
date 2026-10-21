---
status: draft
target: v3.6.0
---

# Extraction history

## Why

Every run leaves an output folder, but nothing remembers which playlists were
extracted, when, with which options or where the result went. A history lets
the user find a past output and repeat a run without setting everything up again.

## Acceptance criteria

- [ ] AC1 — Every successful extraction (menu or quick mode) adds an entry:
  date, playlist name, channel, URL, number of videos and songs, output folder,
  and the extraction options used.
- [ ] AC2 — Failed runs are not recorded.
- [ ] AC3 — The **History** entry of the main menu (hidden since
  `menu-restructure`) is enabled and lists entries newest first.
- [ ] AC4 — Picking an entry offers: re-run with that run's options, re-run the
  same URL with the current options, show the output folder path, delete the entry.
- [ ] AC5 — History is capped (oldest entries dropped) and survives restarts.
- [ ] AC6 — Everything read back goes through sanitization: an entry written by
  an older version with options that no longer exist doesn't break the menu or
  a re-run.
- [ ] AC7 — An entry whose output folder no longer exists still shows, marked
  as such.
- [ ] AC8 — `--reset-config` (from `cli-essentials`) also clears the history.

## Contract

- `config.ts`: history read/append/delete functions, with its own sanitizer.
- History entry type in `types.ts`.
- i18n keys in every locale for the submenu, the entry actions and the
  "output missing" mark.

## Out of scope

- Comparing two runs, or showing what changed in a playlist between runs.
- Recording failed runs.

## Open questions

- Does the history **replace** `recentUrls`? They overlap almost completely,
  and two similar stores can drift apart. (Suggestion: yes, the URL picker
  reads its recent URLs from the history.)
- How many entries are kept?
- Is there a quick-mode way to see it (`--history`), or is it menu-only?

## Tasks

<!-- To be written on approval. -->
