# Playlist Extractor

Extracts songs from YouTube playlists. It uses web scraping with Playwright to get the
ordered list of songs from a playlist and exports it to **JSON, CSV, and Excel**.

The focus is on "songs", not just "videos": it breaks the title down into main artist(s),
featured artists, song name, mix type, and genre(s). When a video is a long album or mix, it
opens its page, reads the tracklist from the description, and expands it into individual songs.

## Requirements

- **Node 24+** (runs `.ts` files directly) or **Bun**.
- Dependencies installed and the Playwright browser downloaded:

```bash
pnpm install
pnpm exec playwright install chromium
```

## Usage

From the project folder:

```bash
# With Bun (faster)
bun playlist-extractor.ts "PLAYLIST_URL"

# With Node
node playlist-extractor.ts "PLAYLIST_URL"
```

> The quotes `"..."` matter: YouTube URLs contain `&` and `?`, which the shell would
> otherwise misinterpret.

You can also use the `package.json` scripts (pass the URL after `--`):

```bash
pnpm extract:bun -- "URL"   # Bun
pnpm extract -- "URL"       # Node
```

### Limit the number of videos (handy for quick tests)

```bash
bun playlist-extractor.ts "URL" 10                 # only the first 10
PLAYLIST_MAX=10 bun playlist-extractor.ts "URL"    # equivalent via environment variable
```

### Full example

```bash
bun playlist-extractor.ts "https://www.youtube.com/playlist?list=PLRBp0Fe2GpgnIh0AiYKh7o7HnYAej-5ph" 5
```

## Output

Each run creates a subfolder inside `output/` named after the playlist and the local
date/time:

```
output/My Playlist_2026-06-19_03-40-13/
├── playlist.json
├── playlist.csv
└── playlist.xlsx
```

### Fields per song

| Field             | Description                                                            |
| ----------------- | --------------------------------------------------------------------- |
| `position`        | Position in the playlist (`5`, or `5.1`, `5.2`… for album tracks)     |
| `artists`         | Main artists (split by `,`, `&`, `x`, `vs`)                           |
| `featuredArtists` | Featured artists (`feat.`, `ft.`, `featuring`, `with`)                |
| `songTitle`       | Cleaned-up song name                                                  |
| `mixType`         | `original`, or `remix` / `bootleg` / `edit`… when applicable          |
| `genres`          | Genre(s) detected in the title (empty if none)                        |
| `rawTitle`        | Original, unprocessed title                                           |
| `channel`         | Video channel                                                         |
| `videoType`       | `single`, `album`, `mix`, or `unknown`                                |
| `availability`    | `available` or `unavailable` (private/deleted)                        |
| `duration`        | Duration shown in the playlist                                        |
| `videoId`, `url`, `thumbnail` | Video identifiers                                         |
| `parentVideoId`   | Parent video, only on tracks expanded from an album/mix               |
| `startTimestamp`  | Timestamp of the track within the album/mix (if available)            |

> Multi-valued fields (`artists`, `featuredArtists`, `genres`) are exported as an **array** in
> JSON and as **text separated by `;`** in CSV and Excel.

## Tests

```bash
pnpm test
```

Uses Node's built-in test runner (`node:test`) against the parsing functions in `tests/`.

## Notes

- Title and tracklist parsing is **best-effort**: it depends on how each channel writes its
  titles, which is why the `rawTitle` is always kept for manual review.
- YouTube's DOM selectors may change over time. `debug-dom.ts` is a probe to inspect the
  page's current structure if something stops working.
