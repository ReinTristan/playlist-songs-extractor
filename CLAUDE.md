# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A CLI that scrapes a YouTube playlist with Playwright and exports the ordered list of songs to JSON, CSV, and/or Excel. It parses each video title into artist(s), featured artist(s), song name, mix type, and genre(s), and — for long videos flagged as albums/mixes — opens the video page and expands its description's tracklist into individual song rows.

## Commands

```bash
pnpm install
pnpm exec playwright install chromium   # required once, before first run

pnpm test                    # node --test tests/*.test.ts
node --test tests/cli.test.ts             # run a single test file
node --test tests/cli.test.ts --test-name-pattern="normalizeUrl"  # single test/describe

node src/cli.ts                           # interactive menu (needs a TTY)
node src/cli.ts "PLAYLIST_URL" [maxN]     # quick mode, no menu
bun src/cli.ts "PLAYLIST_URL" [maxN]      # same, via Bun (faster)
pnpm extract -- "URL"                     # npm-script equivalent (Node)
pnpm extract:bun -- "URL"                 # npm-script equivalent (Bun)

pnpm exec biome check .      # lint + format check (no lint/format script defined in package.json)
pnpm exec biome check --write .
```

Quote the playlist URL argument — YouTube URLs contain `&`/`?` that the shell would otherwise split.

There is no build step: `.ts` files run directly under Node 24+ or Bun. `tsconfig.json` has `noEmit: true` and is used for type-checking only (`pnpm exec tsc --noEmit`).

## Architecture

Three source files, deliberately separated by responsibility (see the header comment in each):

- **`src/types.ts`** — all shared domain types (`PlaylistVideo`, `Track`, `ParsedTitle`, `Song`, `ExtractConfig`) and every pure data constant: output `COLUMNS`, heuristic keyword lists (`ALBUM_KEYWORDS`, `MIX_KEYWORDS`, `MIX_TYPE_KEYWORDS`, `GENRE_KEYWORDS`), noise-stripping regexes, and the shared timestamp grammar (`TS_PATTERN` and the regexes built from it). No logic lives here — this is the single source of truth other modules import constants from, to avoid duplicated keyword lists.
- **`src/extractor.ts`** — all the actual logic, exported as pure functions plus one orchestrator:
  - Pure/testable functions (exported at the bottom for tests): `parseTitle`, `parseTracklist`, `classifyVideoType`, `durationToSeconds`, `sanitizeFilename`, `videoToSong`, `trackToSong`.
  - Playwright-driving functions: `scrapePlaylist` (loads the playlist page, scrolls to lazy-load all items, reads title/channel/videos from the DOM), `fetchTracklist` (opens a single video page and reads its description).
  - `runExtraction(config, sharedBrowser?)` — the orchestrator. Scrapes the playlist, and for every video flagged `isCandidate` (long + album/mix keyword match) also fetches and parses its tracklist, expanding it into per-track `Song` rows. Writes `output/<channel-playlist>_<timestamp>/playlist.{json,csv,xlsx}` via `writeOutputs`. Accepts an optional shared `Browser` so the interactive CLI can reuse one Chromium instance across multiple runs instead of relaunching it each time.
- **`src/cli.ts`** — entry point only. Interactive menu (via `@clack/prompts`) that mutates an `ExtractConfig` in place and calls `runExtraction` per "▶ Extraer" action, keeping settings between runs; or a legacy argv-based quick mode (`node src/cli.ts URL [maxVideos]`) for non-interactive/scripted use. Also exports `normalizeUrl` and `parseMaxVideos`, which are unit-tested directly.
- **`src/debug-dom.ts`** — standalone probe script (not imported anywhere) for inspecting YouTube's current DOM structure when scraping selectors break. Run it directly with `node`/`bun` when a change in YouTube's markup causes `scrapePlaylist` to return empty/wrong data.

### Data flow

`scrapePlaylist` (DOM) → `PlaylistVideo[]` → for candidates, `fetchTracklist` (DOM) → `Track[]` → `buildSongRows` flattens both videos and their expanded tracks into `Song[]` via `videoToSong`/`trackToSong` → `writeOutputs` projects the selected `columns` and writes JSON (nested array, native types) and/or CSV/XLSX (flattened, multi-value fields joined with `; `) through a shared `ExcelJS.Workbook`.

`parseTitle` is applied to both whole video titles and individual tracklist-line titles (same heuristics, same function) — it strips featured-artist mentions, detects a mix type, detects whitelisted genres from bracketed text, strips "noise" tags (official video, HD, etc.), and splits the remainder on the first dash into artist(s) / song title.

`parseTracklist` has two independent strategies tried in order against a video description: (A) lines containing a `(h:)mm:ss` timestamp, (B) numbered lines (`1.`/`1)`/`1 -`). Each strategy is accepted only if it yields ≥3 tracks; otherwise the video falls back to being treated as a single, unexpanded song.

### Important scraping/heuristic invariants (see inline comments in `extractor.ts` for the "why")

- Playlist scraping is scoped to the first `yt-item-section-renderer`/`ytd-item-section-renderer` on the page — later sections are YouTube's "recommended videos/playlists" and must not leak into results.
- `MIX_KEYWORDS` intentionally excludes the bare word "mix" — it over-matches song titles like "(Extended Mix)"/"(VIP Mix)" as false DJ-set/compilation detections.
- Only videos ≥ `LONG_VIDEO_SECONDS` (18 min) are ever opened to fetch a tracklist (`isCandidate`); shorter videos matching album/mix keywords are labeled but not expanded.
- `position` for expanded tracks is `"<videoIndex>.<trackIndex>"` (e.g. `5.1`, `5.2`); non-expanded songs use the plain video index.

## Testing

Uses Node's built-in `node:test` runner against files in `tests/`, importing functions straight from `src/*.ts` (no compiled output). Tests target the pure parsing/classification functions and `cli.ts`'s `normalizeUrl`/`parseMaxVideos`; there is no test coverage that drives real Playwright/browser scraping.

## Output shape

Each run creates `output/<channel>-<playlist title>_<YYYY-MM-DD_HH-mm-ss>/`. `playlist.json` is `{ name, total, songs }`, not a bare array — `songs` entries only include the columns selected for that run (`ExtractConfig.columns`). CSV/XLSX share a single flattened representation where array fields (`artists`, `featuredArtists`, `genres`) become `; `-joined strings; JSON keeps them as arrays.
