# Playlist Extractor

Made with ❤️ with the help of baker claude.

Extracts songs from YouTube playlists. It uses web scraping with Playwright to get the
ordered list of songs from a playlist and exports it to **JSON, CSV, and Excel**.

The focus is on "songs", not just "videos": it breaks the title down into main artist(s),
featured artists, song name, mix type, and genre(s). When a video is a long album or mix, it
opens its page, reads the tracklist from the description, and expands it into individual songs.

## Requirements

- **Node 24+** (runs `.ts` files directly) or **Bun**.
- Dependencies installed and the Playwright browser downloaded:
- pnpm for package manager as listed in package.json.

```bash
pnpm install
pnpm exec playwright install chromium
```

## Usage

### Interactive mode (recommended)

Run the CLI without arguments to open an interactive menu:

```bash
# With Bun (faster)
bun src/index.ts

# With Node
node src/index.ts
```

The very first time, it asks whether the detected system language is the one you want, and
lets you pick another. The answer is saved, so it is asked only once (see
[Language](#language)).

The menu lets you configure each option and then choose **▶ Extract**. After a run it
returns to the menu **keeping your settings**, so you can process several playlists in a
row by just changing the URL. Configurable options:

- **Playlist URL** — full URL or a bare list ID.
- **Video limit** — either _All_, or a number you type in (an integer ≥ 1).
- **Output formats** — any combination of JSON, CSV, and Excel (XLSX).
- **Expand albums/mixes** — toggle expanding long albums/mixes into individual songs.
- **Columns to save** — pick exactly which columns/fields are written to the files.
- **Column order** — reorder the selected columns (moves them up/down); affects the column
  order in CSV/XLSX and the key order in JSON.
- **Extra options** — experimental toggles, disabled by default:
  - _Song order_ — keep the original YouTube order, reverse it, sort alphabetically by song
    title (A→Z or Z→A), or shuffle randomly. Whenever the order changes, `position` is
    renumbered sequentially (1, 2, 3…) instead of keeping the original playlist position.
  - _Exclude unavailable_ — drop private/deleted videos from the output instead of
    including them with empty fields.
- **Language** — switch language on the spot; the menu re-renders in it and the choice is
  saved for the next run.

### Quick mode (non-interactive)

Pass the URL as an argument to run once and exit, using default settings:

```bash
# With Bun (faster)
bun src/index.ts "PLAYLIST_URL"

# With Node
node src/index.ts "PLAYLIST_URL"
```

> The quotes `"..."` matter: YouTube URLs contain `&` and `?`, which the shell would
> otherwise misinterpret.

You can also use the `package.json` scripts (pass the URL after `--`):

```bash
pnpm extract:bun -- "URL"   # Bun
pnpm extract -- "URL"       # Node
```

#### Limit the number of videos (handy for quick tests)

```bash
bun src/index.ts "URL" 10                 # only the first 10
PLAYLIST_MAX=10 bun src/index.ts "URL"    # equivalent via environment variable
```

Omit it to process every video. If given, it must be an integer ≥ 1 — anything else exits
with an error instead of silently processing the whole playlist.

#### Pick the language

```bash
bun src/index.ts "URL" --lang=fr        # also --lang fr, or the --locale alias
PLAYLIST_LANG=fr bun src/index.ts "URL" # equivalent via environment variable
```

The flag can go anywhere in the argument list, and it is a one-off override: unlike the
interactive menu, it does **not** change the saved preference.

#### Full example

```bash
bun src/index.ts "https://www.youtube.com/playlist?list=PLRBp0Fe2GpgnIh0AiYKh7o7HnYAej-5ph" 5
```

## Language

> [!WARNING]
> French translation was made by claude so may be innacurate.

The CLI ships in **English, Spanish and French** (powered by [i18next](https://www.i18next.com/)).
The language is resolved in this order, first match wins:

1. `--lang=<code>` / `--locale=<code>` on the command line
2. the `PLAYLIST_LANG` environment variable
3. the preference saved on the first run
4. the system locale (`LC_ALL`/`LANG`, region stripped: `fr_FR` → `fr`)
5. English, as the fallback

An explicitly requested language that does not exist exits with an error listing the
available codes. The saved preference lives in a small JSON file managed by
[conf](https://github.com/sindresorhus/conf) (`~/.config/playlist-extractor/config.json` on
Linux); `PLAYLIST_CONFIG_DIR` can point it somewhere else, which is what the tests use.

**What gets translated:** everything you see — menus, prompts, progress logs, the CSV/XLSX
column headers and the Excel sheet name. **What does not:** the data itself. JSON keys stay
`position`, `songTitle`, … and values like `single` / `mix` / `available` / `original` stay
canonical in every language, so runs made in different languages remain comparable.

### Adding a language

No code changes needed:

1. Add an entry to `locales/meta.json` with its `code`, `nativeName`, and the two `firstRun`
   strings (written in that language — they render the first-run prompt before any
   translation file is loaded).
2. Copy `locales/en/translation.json` into `locales/<code>/translation.json` and translate
   the values, keeping every key.

`pnpm test` then checks that the new file has exactly the same keys as the English one, and
that every column, format and song order has a label.

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

| Field                         | Description                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `position`                    | Position in the playlist (`5`, or `5.1`, `5.2`… for album tracks) |
| `artists`                     | Main artists (split by `,`, `&`, `x`, `vs`)                       |
| `featuredArtists`             | Featured artists (`feat.`, `ft.`, `featuring`, `with`)            |
| `songTitle`                   | Cleaned-up song name                                              |
| `mixType`                     | `original`, or `remix` / `bootleg` / `edit`… when applicable      |
| `genres`                      | Genre(s) detected in the title (empty if none)                    |
| `rawTitle`                    | Original, unprocessed title                                       |
| `channel`                     | Video channel                                                     |
| `videoType`                   | `single`, `album`, `mix`, or `unknown`                            |
| `availability`                | `available` or `unavailable` (private/deleted)                    |
| `duration`                    | Duration shown in the playlist                                    |
| `videoId`, `url`, `thumbnail` | Video identifiers                                                 |
| `parentVideoId`               | Parent video, only on tracks expanded from an album/mix           |
| `startTimestamp`              | Timestamp of the track within the album/mix (if available)        |

> Multi-valued fields (`artists`, `featuredArtists`, `genres`) are exported as an **array** in
> JSON and as **text separated by `;`** in CSV and Excel.

> The field names above are the canonical ones and never change. In CSV/XLSX the _header_
> row is localized (`songTitle` → `Canción` / `Chanson`), but the values in it are not.

### JSON shape

`playlist.json` is a wrapper object (not a flat array of songs):

```json
{
	"name": "Channel-My Playlist",
	"total": 42,
	"songs": [
		{
			"position": "1",
			"artists": ["Artist"],
			"songTitle": "Song"
		}
	]
}
```

Each entry in `songs` contains only the columns selected for the run.

## Tests

```bash
pnpm test
```

Uses Node's built-in test runner (`node:test`) against the parsing functions in `tests/`,
plus `tests/i18n.test.ts`, which keeps the translation files in sync (same keys in every
language, a label for every column/format/song order).

## Notes

- Title and tracklist parsing is **best-effort**: it depends on how each channel writes its
  titles, which is why the `rawTitle` is always kept for manual review.
- YouTube's DOM selectors may change over time. `src/debug-dom.ts` is a probe to inspect the
  page's current structure if something stops working.
- For Testing you can use this playlist urls (limited to 150 songs to not overload the tests):

| Channel      | Playlist URL id            |
| ------------ | -------------------------- |
| Galaxy Music | UULFIKF1msqN7lW9gplsifOPkQ |
| xKito Music  | UULFMOgdURr7d8pOVlc-alkfRg |
