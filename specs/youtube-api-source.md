---
status: draft
target: v4
---

# YouTube Data API v3 as a second source

> Seeded from the old `ToDo.md`. Still a draft: the open questions below have
> to be settled before any test is written.

## Why

Scraping is slow (minutes for a big playlist), fragile against YouTube's
markup changes and rate-limited by anti-bot walls (see [extended-mode](extended-mode.md)). The API returns
the same data, plus more, in seconds and as a plain mockable `fetch`.

The groundwork is already done ([source-layer-split](source-layer-split.md)): the extractor only consumes
`PlaylistPayload`/`RawPlaylistVideo`, so a new source can be added as a sibling
of `src/sources/scrape.ts` without touching it.

## Acceptance criteria

<!-- To be written once the open questions are resolved. -->

## Contract

Known so far:

- New `src/sources/api.ts`, returning the same `PlaylistPayload` as the scraper.
- `toPlaylistVideos` and `parseTracklist` are source-agnostic and are reused as is.
- No separate `readDescription` is needed: `videos.list` returns duration and
  description in the same call.
- `availability` is detected by each source its own way and handed over
  already normalized (the API reports it through a field, not a placeholder title).
- Each source reports whether it's usable (`checkScrapeAvailability()` from
  `cli-essentials` is the precedent). A source that isn't (no Playwright/Chromium,
  no API key) shows up disabled in the menu with the reason as a hint and
  isn't the default; the program never crashes or hangs because of it.

## Out of scope

- A `stats` extraction preset built on the new columns: its own spec, after
  this one (see `extraction-presets`).

## Open questions

- Is the API a full alternative source (playlist + descriptions), or only the
  optional "extended data" layer from [extended-mode](extended-mode.md), with scraping still fetching the
  playlist? Or both?
- How is the source chosen: automatically when `YOUTUBE_API_KEY` is set, a
  flag/menu option, or both? Zero-config must keep working without a key.
- The common interface of both sources: `ScrapeSession` is today the scraper's
  concrete type. Decide what the two implementations actually share, not
  before.
- Do the extra fields (views, likes, publish date, tags, category) become new
  `Song` columns? If so: what do scraper runs put in them?
- Behaviour on quota exhaustion / invalid key: hard error or fall back to
  scraping?

## Tasks

<!-- To be written on approval. -->
