---
status: done
shipped: v3.2.0 (cd75259)
---

# Split the source layer out of the extractor

> Written retroactively, migrated from the old `ToDo.md`.

## Why

`scrapePlaylist` was a ~200-line function mixing navigation, DOM reading and
interpretation, and the post-processing had no tests because it could only run
inside a browser. A second data source ([youtube-api-source](youtube-api-source.md)) was also on the horizon, and
it had nowhere to go.

## Acceptance criteria

- [x] AC1 — Everything that talks to YouTube lives in `src/sources/scrape.ts`
  behind a `ScrapeSession` (`fetchPlaylist`, `readDescription`, `close`).
- [x] AC2 — The source hands over raw data only (`RawPlaylistVideo[]` inside a
  `PlaylistPayload`); it interprets nothing.
- [x] AC3 — `extractor.ts` doesn't import Playwright; the derivation of
  `durationSeconds`, `videoType`/`isCandidate` and `channel` lives in
  `toPlaylistVideos` and is unit-tested (`tests/scrape-post-process.test.ts`).
- [x] AC4 — The old function is split into `resolveScope`,
  `scrollUntilStable`, `readPlaylistMetadata` and `readRawVideos`.
- [x] AC5 (manual) — A real playlist produces the same output as before.

## Contract

- `openScrapeSession(): Promise<ScrapeSession>`
- `RawPlaylistVideo` (raw signals, channel unresolved) vs `PlaylistVideo`
  (derived fields, channel resolved).
- `runExtraction(config, session?)` accepts an optional session so the menu
  can reuse one browser across runs.

## Out of scope

- A common interface for multiple sources: deliberately not invented until the
  second source exists (see [youtube-api-source](youtube-api-source.md)).

## Open questions

## Tasks

- [x] `tests/scrape-post-process.test.ts`
- [x] `src/types.ts` — raw vs processed video types
- [x] `src/sources/scrape.ts`
- [x] `src/extractor.ts`, `src/cli.ts`
- [x] `CLAUDE.md`
