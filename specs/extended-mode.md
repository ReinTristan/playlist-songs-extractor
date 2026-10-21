---
status: discarded
evaluated: 2026-08-05
---

# Extended mode: open every video for more data

> Migrated from the old `ToDo.md`.

## Why

Get per-video data the playlist page doesn't show: views, likes, publish date,
tags and category.

## Acceptance criteria

Not written: the idea was rejected before reaching that point.

## Why it was discarded

Today only album/mix candidates (≥ `longVideoSeconds`) are opened, a handful
of pages per run. Extended mode turns that into one navigation per video: on a
200-video playlist that's ~200 watch-page loads (several MB each, because of
the player) from one IP in about ten minutes.

The failure mode isn't a permanent ban (there's no account involved; blocking
is per-IP and temporary). It's worse than that: YouTube starts serving an
anti-bot wall and the scraper writes an **empty output that looks like a
success**. And it fails precisely on big playlists, which are the reason this
project exists.

## The alternative, if this is ever revisited

The YouTube Data API v3 (see [youtube-api-source](youtube-api-source.md)). `videos.list` takes 50 IDs per request with
`part=snippet,statistics,contentDetails` and costs 1 quota unit per call on a
10,000/day free tier. A 200-video playlist is 4 requests and ~1 second, versus
10-15 minutes of scraping. It returns `viewCount`, `likeCount` (the most fragile
field to scrape), `publishedAt`, `tags` and `categoryId` cleanly, and the code
becomes a mockable `fetch` with no Playwright.

**The real reason it wasn't taken:** it requires an API key, and today the
project runs with `pnpm install` and nothing else. That property is worth more
than the feature. If revisited, the design would be: scraping stays for the
playlist (zero config), and extended data is an optional layer enabled only
when `YOUTUBE_API_KEY` is set.

## Scope note for similar future features

`readDescription` already visits the video page and reads a single field of
`ytInitialPlayerResponse`. Anything needing more data from that page should
reuse that navigation (raw payload → pure parsers), never open the page twice.
