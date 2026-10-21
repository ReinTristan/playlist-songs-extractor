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

node src/index.ts                         # interactive menu (needs a TTY)
node src/index.ts "PLAYLIST_URL" [maxN]   # quick mode, no menu
bun src/index.ts "PLAYLIST_URL" [maxN]    # same, via Bun (faster)
node src/index.ts "URL" --lang=fr         # one-off locale override (also PLAYLIST_LANG=fr)
node src/index.ts "URL" --formats=json --columns=position,songTitle --dedupe   # quick-mode flags
pnpm extract -- "URL"                     # npm-script equivalent (Node)
pnpm extract:bun -- "URL"                 # npm-script equivalent (Bun)

pnpm exec biome check .      # lint + format check (no lint/format script defined in package.json)
pnpm exec biome check --write .
```

Quote the playlist URL argument — YouTube URLs contain `&`/`?` that the shell would otherwise split.

`PLAYLIST_CONFIG_DIR=<dir>` redirects the `conf` store (saved locale, last-used config, recent URLs) — use it when running the CLI by hand so a test run never overwrites the real preferences.

There is no build step: `.ts` files run directly under Node 24+ or Bun. `tsconfig.json` has `noEmit: true` and is meant for type-checking only — run it with `pnpm exec tsc --noEmit` (TypeScript is a dev dependency).

## Architecture

Source files deliberately separated by responsibility (see the header comment in each). The top-level split is **source layer** (`src/sources/`, talks to YouTube and returns raw data) vs **processing layer** (`src/extractor.ts`, interprets it and doesn't know where it came from) — that boundary exists so a second source (the YouTube Data API v3, see `specs/youtube-api-source.md`) can be added as a sibling of `scrape.ts` without touching the extractor.

- **`src/types.ts`** — all shared domain types (`RawPlaylistVideo`, `PlaylistVideo`, `PlaylistPayload`, `Track`, `ParsedTitle`, `Song`, `ExtractConfig`) and every pure data constant: output `COLUMNS`, heuristic keyword lists (`ALBUM_KEYWORDS`, `MIX_KEYWORDS`, `MIX_TYPE_KEYWORDS`, `GENRE_KEYWORDS`), noise-stripping regexes, the shared timestamp grammar (`TS_PATTERN` and the regexes built from it), the dash grammar (`DASH_CHARS`/`DASH_CLASS`), the YouTube DOM selectors (`YT_SELECTORS`, `CHANNEL_HREF_SOURCE`, `DESKTOP_USER_AGENT`) and the scraper timings. No logic lives here — this is the single source of truth other modules import constants from, to avoid duplicated keyword lists.
- **`src/sources/scrape.ts`** — the only source implementation today: Playwright. Navigates, fights the DOM and returns **raw** data; it interprets nothing. `openScrapeSession()` launches Chromium + one page and returns a `ScrapeSession` with `fetchPlaylist(url, limit)` → `PlaylistPayload`, `readDescription(videoId)` → the description as a plain string, and `close()`. Internally split into the four steps that used to be one 200-line function: `resolveScope` (waits for content, **then** picks the scope selector), `scrollUntilStable` (lazy-load loop), `readPlaylistMetadata` (title + channel) and `readRawVideos` (the item array). Both `fetchPlaylist` and `readDescription` check `response.ok()` and throw; deciding whether that is fatal belongs to the caller.
- **`src/extractor.ts`** — the processing layer, exported as pure functions plus one orchestrator:
  - Pure/testable functions (exported at the bottom for tests): `parseTitle`, `parseTracklist`, `classifyVideoType`, `toPlaylistVideos`, `videoToSong`, `trackToSong`, `resolveChannelNames`, `applySongOrder`, `dedupeSongs`, `applySongFilters`, `buildSongRows`, `flattenForTable`, `projectSong`. (`durationToSeconds`/`sanitizeFilename` live in `utils.ts` and are imported, not re-exported.)
  - `toPlaylistVideos(raw, longVideoSeconds)` is the source-agnostic post-process: it derives `durationSeconds`, `videoType`/`isCandidate` and the resolved `channel` from a `RawPlaylistVideo[]`. It lives here, not in `sources/`, because it is computed the same way regardless of where the videos came from — and it is the one part of the old `scrapePlaylist` that can be unit-tested without a browser.
  - `runExtraction(config, session?)` — the orchestrator. Asks the source for the playlist, post-processes it, and for every video flagged `isCandidate` (long enough, see below) also reads and parses its tracklist, expanding it into per-track `Song` rows. A video whose description fails is warned about and skipped, not fatal. Writes `output/<channel-playlist>_<timestamp>/playlist.{json,csv,xlsx}` via `writeOutputs`. Accepts an optional `ScrapeSession` so the interactive CLI can reuse one browser across multiple runs; without it, it opens and closes its own. The pre-validation runs **before** any session is opened, so an invalid config never costs a Chromium launch (and `tests/run-extraction.test.ts` never spawns one).
- **`src/cli.ts`** — interactive menu (via `@clack/prompts`) that mutates an `ExtractConfig` in place and calls `runExtraction` per "▶ Extract" action, keeping settings between runs. Also exports `promptFirstRunLocale`, the first-run language question.
- **`src/index.ts`** — the entry point. Resolves the locale and `await initI18n(...)` **before printing anything**, then dispatches: argv quick mode (`node src/index.ts URL [maxVideos] [flags]`) or the interactive menu (asking for the language once, if nothing is saved yet). `applyFlags` maps the quick-mode flags onto `ExtractConfig`, validating every value against `FORMATS`/`COLUMNS`/`SONG_ORDERS`/`VIDEO_TYPES` and exiting 1 with a translated message on anything unknown.
- **`src/i18n.ts`** — everything user-visible. `loadMeta`/`supportedLocales` (read `locales/meta.json` synchronously), `resolveLocale` (pure, unit-tested: `--lang` > `PLAYLIST_LANG` > conf > system > fallback), `initI18n`/`changeLocale`, the `t()` wrapper (returns the key when i18next is not initialized, so unit tests can import `extractor.ts` without setup), and the label helpers `columnHeader`/`formatLabel`/`songOrderLabel`/`videoTypeLabel`.
- **`src/config.ts`** — thin `conf` wrapper for persisted preferences: the locale, the last-used config (`lastConfig`) and the last playlist URLs (`recentUrls`). The store is created **lazily** so that merely importing the module never touches disk, and honours `PLAYLIST_CONFIG_DIR`. Everything read back goes through `sanitizeConfig`, which drops formats/columns/orders that no longer exist — a store written by an older version must never silently corrupt the output.
- **`src/utils.ts`** — pure, domain-free helpers shared by CLI/extractor/debug script: `normalizeUrl`, `parsePositiveInt`, `parseFlags`, `parseLangFlag`, `durationToSeconds`, `sanitizeFilename`, `shuffle`, `sleep`, `osLocale`.
- **`locales/`** — `meta.json` (the single source of truth for which languages exist: code, native name, and the two first-run strings _in that language_, so the first prompt renders without loading any namespace) plus `<lng>/translation.json` per language, loaded on demand by `i18next-fs-backend`.
- **`src/debug-dom.ts`** — standalone probe script (not imported anywhere) for inspecting YouTube's current DOM structure when scraping selectors break. Run it directly with `node`/`bun` when a change in YouTube's markup causes `sources/scrape.ts` to return empty/wrong data.

### Data flow

`fetchPlaylist` (DOM) → `RawPlaylistVideo[]` → `toPlaylistVideos` → `PlaylistVideo[]` → for candidates, `readDescription` (DOM) → `parseTracklist` → `Track[]` → `buildSongRows` flattens both videos and their expanded tracks into `Song[]` via `videoToSong`/`trackToSong` → `writeOutputs` projects the selected `columns` and writes JSON (nested array, native types) and/or CSV/XLSX (flattened, multi-value fields joined with `; `) through a shared `ExcelJS.Workbook`.

`RawPlaylistVideo` is what a source hands over: raw signals only, no derived fields, and the channel still unresolved (the anchors on one side, the metadata-row text on the other). `PlaylistVideo` is that minus the unresolved signals plus what `toPlaylistVideos` derives. `availability` is the exception that stays on the source side: the literal `[Private video]`/`[Deleted video]` titles are an artifact of how YouTube renders the page, and the API would report the same thing through a different field — each source detects it its own way and hands over the answer already normalized.

`parseTitle` is applied to both whole video titles and individual tracklist-line titles (same heuristics, same function) — it strips featured-artist mentions, detects a mix type, detects whitelisted genres from bracketed text, strips "noise" tags (official video, HD, etc.), and splits the remainder on the first dash into artist(s) / song title.

Order matters in `parseTitle`: the mix-type text is _detected_ in step 2 but only _removed_ in step 4, after genres have been read — a `(Deep House Remix)` bracket has to survive long enough for step 3 to pick up its genre. Removal of a bare (unbracketed) mix type is deliberately restricted to the last dash-separated segment, and only when another separator precedes it: in `Artist - Cover Me In Sunshine` that last segment _is_ the song.

`parseTracklist` has two independent strategies tried in order against a video description: (A) lines containing a `(h:)mm:ss` timestamp, (B) numbered lines (`1.`/`1)`/`1 -`). Each strategy is accepted only if it yields ≥3 tracks; otherwise the video falls back to being treated as a single, unexpanded song.

### Important scraping/heuristic invariants (see inline comments in `sources/scrape.ts` and `extractor.ts` for the "why")

- The scope is resolved **once**, by `resolveScope`, and the same selector is used both to scroll and to read — otherwise it can happen that one scope is lazy-loaded and a different one is read. It prefers `ytd-playlist-video-list-renderer` when present (older YouTube UI variant where "suggested videos to add" can render as siblings inside the _same_ `yt-item-section-renderer`/`ytd-item-section-renderer` as the real content on short playlists); otherwise the first `YT_SCOPE_SELECTORS` entry that exists — later sections are YouTube's "recommended videos/playlists" and must not leak into results. That decision **must** come after the `waitForSelector` for playlist items: `locator.count()` does not auto-wait, and `domcontentloaded` fires before YouTube hydrates, so asking first makes a slow machine fall back to the permissive scope. `readRawVideos` still falls back to the whole `document` if the selector matches nothing, so a markup change degrades instead of returning an empty playlist.
- Both `fetchPlaylist` and `readDescription` check `response.ok()`: Playwright does not throw on 4xx/5xx, so without it a dead or private playlist scrapes "fine", finds 0 videos and writes an output folder that looks like a successful run. `runExtraction` additionally refuses to write anything when 0 videos were found.
- Selectors, the channel-href regex and the user agent live in `types.ts` and are passed into `page.evaluate` as arguments (the browser context has no access to Node imports, and arguments are JSON-serialized — hence `CHANNEL_HREF_SOURCE` being a string). `debug-dom.ts` imports the same constants: a debug script looking at stale selectors is worse than no debug script.
- `channel` on `PlaylistVideo`/`Song` is `string[]`, not `string` — YouTube's "collaboration" videos have multiple owner channels with no `<a href="/channel/...">` anchors at all (names appear as plain text, e.g. "Alan Walker and Au/Ra"); the source hands both signals over raw (`chanAnchorTexts`, `metaRowText`) and `resolveChannelNames` in `extractor.ts` prefers anchor text when present and falls back to splitting that plain text otherwise.
- `MIX_KEYWORDS` intentionally excludes the bare word "mix" — it over-matches song titles like "(Extended Mix)"/"(VIP Mix)" as false DJ-set/compilation detections.
- Only videos ≥ `ExtractConfig.longVideoSeconds` (default `LONG_VIDEO_SECONDS`, 18 min) are ever opened to fetch a tracklist (`isCandidate`); shorter videos matching album/mix keywords are labeled but not expanded. Being long makes a video a _candidate_ but does not label it: without an album/mix keyword its `videoType` stays `single` (a 25-minute extended track is neither an album nor a mix).
- `position` for expanded tracks is `"<videoIndex>.<trackIndex>"` (e.g. `5.1`, `5.2`); non-expanded songs use the plain video index.

### i18n invariants

- **Translate what is seen, never what is computed.** Column headers, the Excel sheet name, menu labels and progress logs go through `t()`; `Song`/`COLUMNS` keys and data values (`videoType`, `availability`, `mixType`) stay canonical in every language, so exports from different languages remain comparable. `types.ts` therefore holds **no** visible text: `COLUMNS` is `{ key, width }`, and `FORMATS`/`SONG_ORDERS` are plain value lists whose labels come from `locales/`.
- Adding a column/format/song order/video type means adding its key under `columns`/`formats`/`songOrders`/`videoTypes` in **every** language — `tests/i18n.test.ts` fails otherwise, along with any key present in one language and missing in another.
- "All videos" is the boolean `ExtractConfig.allVideos`, never a word to compare (`"todos"`/`"all"`/`"tous"` would not scale): the menu offers a choice, quick mode just omits the argument, and `maxVideos` is only read when `allVideos` is false. Internally `fetchPlaylist` takes `limit: number | null`.
- Messages thrown by `runExtraction`'s pre-validation stay untranslated on purpose — they are function-contract errors (guarded by the menu before the user can hit them), and the tests match on them.

## Testing

Uses Node's built-in `node:test` runner against files in `tests/`, importing functions straight from `src/*.ts` (no compiled output). Tests target the pure parsing/classification functions, the source-agnostic post-process (`toPlaylistVideos`, in `tests/scrape-post-process.test.ts`), the song pipeline (`dedupeSongs`, `applySongFilters`, `applySongOrder`, `buildSongRows`, `flattenForTable`, `projectSong`), `config.ts`'s persistence and sanitization, `utils.ts`'s `normalizeUrl`/`parsePositiveInt`/`parseFlags`/`parseLangFlag`, and `i18n.ts`'s `resolveLocale` plus the locale-file consistency checks; there is no test coverage that drives real Playwright/browser scraping, so anything inside `src/sources/scrape.ts` can only be validated by running it against YouTube.

`tests/helpers/make-config.ts` builds a complete `ExtractConfig` for tests — use it instead of writing the object literal by hand, so adding a field to `ExtractConfig` does not mean editing every test. It lives under `helpers/` on purpose: `pnpm test` globs `tests/*.test.ts`, so it is never picked up as a test file.

Tests that spawn `src/index.ts` must pass `PLAYLIST_LANG` (so assertions do not depend on the machine's locale) and a temp `PLAYLIST_CONFIG_DIR` (so they never read or clobber the real saved preference) — see `runCli` in `tests/cli.test.ts`.

## Output shape

Each run creates `output/<channel>-<playlist title>_<YYYY-MM-DD_HH-mm-ss>/` (with a `_2`, `_3`… suffix if that path already exists — the stamp only has second resolution and `mkdir(recursive)` would happily overwrite). `playlist.json` is `{ name, total, songs }`, not a bare array — `songs` entries only include the columns selected for that run (`ExtractConfig.columns`). CSV/XLSX share a single flattened representation where array fields (`artists`, `featuredArtists`, `genres`) become `; `-joined strings; JSON keeps them as arrays. Only the CSV/XLSX header row and the sheet name are localized; keys and cell values are not.

## Specs (spec-driven development)

New features start as a spec in `specs/` (flow, statuses and index in `specs/decision.md`, template in `specs/_template.md`), **before** tests or code:

- Never write tests or `src/` code for a feature whose spec is not `status: approved`. If there is no spec yet, draft one from `_template.md` and ask Reinhard to review it.
- A spec cannot be approved while it still has open questions.
- Each acceptance criterion maps to at least one test; criteria marked `(manual)` are the ones only verifiable against YouTube (anything in `src/sources/scrape.ts`).
- When the work is done: tick the criteria and tasks, set `status: done` with the version it shipped in, and update the index in `specs/decisions.md`.
- Specs are versioned and are not deleted: a rejected idea gets `status: discarded` and keeps its reasoning.
