/**
 * Song extractor for YouTube playlists (processing / orchestration).
 *
 * This module interprets the raw data handed over by a *source* (`sources/`)
 * and turns it into song rows: classification, title and tracklist parsing,
 * filters, ordering and export. It doesn't know how to talk to YouTube — that's
 * `sources/scrape.ts`'s job (and, in the future, the API source's).
 *
 * Startup lives in `index.ts` (argv quick mode) and `cli.ts` (interactive
 * menu); the shared types and constants, in `types.ts`.
 *
 * Produces output/<playlist>_<local timestamp>/ with the selected formats
 * (playlist.json, playlist.csv, playlist.xlsx).
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'
import { columnHeader, t } from './i18n.ts'
import { openScrapeSession, type ScrapeSession } from './sources/scrape.ts'
import {
	ALBUM_KEYWORDS,
	ANY_TS,
	COLUMNS,
	type Column,
	DASH_CHARS,
	DASH_CLASS,
	type ExtractConfig,
	type Format,
	GENERIC_PLAYLIST_TITLES,
	GENRE_KEYWORDS,
	LEADING_TS,
	LONG_VIDEO_SECONDS,
	MIX_KEYWORDS,
	MIX_TYPE_KEYWORDS,
	NOISE_PATTERNS,
	NUM_LEAD_TS,
	NUM_TAIL_TS,
	type ParsedTitle,
	type PlaylistVideo,
	POLITE_SLEEP_MS,
	RANGE_TS,
	type RawPlaylistVideo,
	type Song,
	type SongOrder,
	TRACK_NUMBER_PATTERN,
	type Track,
	type VideoType,
} from './types.ts'
import {
	durationToSeconds,
	escapeRegex,
	sanitizeFilename,
	shuffle,
	sleep,
} from './utils.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Artist separators, in two classes:
//  - Symbols (, & + × *): accepted with or without surrounding spaces.
//  - Word tokens (x, vs/vs., w/, with, and): require a space on both sides so
//    names DON'T get split ("Sandstorm" on "and", "Maxwell" on "x", etc.).
// A bare "/" is deliberately not a separator, to preserve "Au/Ra", "AC/DC".
// Note: splitting on " and " is aggressive (it splits "Chase and Status"), but
// it's the rule the project already uses for collaboration channels and what's
// wanted here: favour splitting every artist out of a title with many
// separators.
// Regexes derived from DASH_CLASS (types.ts). They're built once at module
// level: they're constants, and the /g ones are always used with
// String.replace, which resets lastIndex on every call.
const FEAT_RE = new RegExp(
	`[([]?\\s*\\b(?:feat|ft|featuring)\\b\\.?\\s*([^)\\]]+?)\\s*(?:[)\\]]|(?=\\s${DASH_CLASS}\\s|$))`,
	'gi',
)
const FEAT_WITH_RE = /[([]\s*(?:with|con)\s+([^)\]]+?)\s*[)\]]/gi
/** Main "artist - song" separator (the dash takes priority). */
const DASH_SPLIT_RE = new RegExp(`^(.*?)\\s+${DASH_CLASS}\\s+(.*)$`)
/** Alternative separator when there's no dash. */
const SLASH_PIPE_SPLIT_RE = /^(.*?)\s+[/|]\s+(.*)$/
/** Spaced dash, to detect the main segment between pipes. */
const SPACED_DASH_RE = new RegExp(`\\s${DASH_CLASS}\\s`)
/** A separator left dangling at the end of the cleaned title. */
const TRAILING_SEPARATOR_RE = new RegExp(`\\s*[${DASH_CHARS}/|]\\s*$`)
/** Junk at the start/end of a tracklist line. */
const TRACK_LINE_LEAD_JUNK_RE = new RegExp(`^[\\s${DASH_CHARS}.)\\][(]+`)
const TRACK_LINE_TAIL_JUNK_RE = new RegExp(`[\\s${DASH_CHARS}.([]+$`)
/** Leftover numbering at the start of a track's text. */
const TRACK_NUMBER_LEAD_RE = new RegExp(`^${TRACK_NUMBER_PATTERN}\\s*`)
/** A numbered tracklist line: "1. ", "12) ", "100 - ". */
const NUMBERED_LINE_RE = new RegExp(`^(\\d{1,3})\\s*[.)${DASH_CHARS}]\\s+(.+)$`)
/** Leftover dash between the leading timestamp and the track title. */
const LEADING_DASH_RE = new RegExp(`^\\s*${DASH_CLASS}\\s*`)

/**
 * The whitelist's genres, precompiled to RegExp. `parseTitle` tests them in a
 * loop against every bracket and every segment of every title, so building
 * them per call meant compiling ~60 regexes per song. The Map also works as an
 * index to ask whether a text *is* exactly a genre.
 */
const GENRE_MATCHERS = new Map<string, RegExp>(
	GENRE_KEYWORDS.map((g) => [g, new RegExp(`\\b${escapeRegex(g)}\\b`, 'i')]),
)

/** A parenthesis/bracket's content, non-nested (steps 3 and 4 of parseTitle). */
const BRACKET_CONTENT_RE = /[([]([^()[\]]+)[)\]]/g

/** Alternation of MIX_TYPE_KEYWORDS, the base of the three regexes below. */
const MIX_TYPE_ALT = MIX_TYPE_KEYWORDS.map((k) => escapeRegex(k)).join('|')
/** Mix descriptor inside a parenthesis/bracket: "(Nero Remix)". */
const BRACKET_MIX_RE = new RegExp(
	`[\\(\\[]([^()\\[\\]]*\\b(?:${MIX_TYPE_ALT})\\b[^()\\[\\]]*)[\\)\\]]`,
	'i',
)
/** Mix descriptor in the last segment after a dash: "- Extended Mix". */
const TAIL_MIX_RE = new RegExp(
	`\\s*${DASH_CLASS}\\s*([^${DASH_CHARS}]*\\b(?:${MIX_TYPE_ALT})\\b[^${DASH_CHARS}]*)$`,
	'i',
)
/** A bare mix keyword, with no delimiter at all. */
const BARE_MIX_RE = new RegExp(`\\b(${MIX_TYPE_ALT})\\b`, 'i')

function splitArtists(raw: string): string[] {
	return raw
		.split(/\s*[,&+×*]\s*|\s+(?:x|vs\.?|w\/|with|and)\s+/gi)
		.map((a) => a.trim())
		.filter(Boolean)
}

/**
 * Accumulates into `into` the whitelist genres present in `text`, without
 * repeats. Shared by `parseTitle`'s step 3 (bracket contents) and 4b
 * (pipe-separated segments), which did exactly the same thing against
 * different text sources.
 */
function collectGenres(text: string, into: string[]): void {
	for (const [genre, re] of GENRE_MATCHERS) {
		if (re.test(text) && !into.some((x) => x.toLowerCase() === genre))
			into.push(genre)
	}
}

/** Splits a title on "|" into clean segments; `[]` if there's no pipe. */
function splitPipeSegments(working: string): string[] {
	if (!working.includes('|')) return []
	return working
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * Decides which segment the title keeps after splitting it on pipes.
 *
 * If one has a dash it's the NCS format ("Artist - Song | Genre | Label"): that
 * segment is the content and the rest are metadata step 4b already read. If
 * none has one, the pipe *is* the artist/song separator, so segments that are
 * pure genre (already captured) are dropped and the rest are returned with the
 * pipe intact for step 5 to split.
 */
function pickPipeMainSegment(segments: string[]): string {
	const dashSeg = segments.find((s) => SPACED_DASH_RE.test(s))
	if (dashSeg) return dashSeg
	const content = segments.filter((s) => !GENRE_MATCHERS.has(s.toLowerCase()))
	return (content.length ? content : segments).join(' | ')
}

/**
 * Resolves a video's channel name(s) from two raw signals read from the DOM.
 * Prefers the channel anchors (the normal case); if there are none
 * ("collaboration" videos with several owner channels, where YouTube puts no
 * links and writes the names as plain text instead, e.g.
 * "Alan Walker and Au/Ra" or with an Oxford comma "A, B, and C"), splits that
 * text on " and "/",".
 */
function resolveChannelNames(
	anchorTexts: string[],
	metaRowText: string,
): string[] {
	const fromAnchors = [
		...new Set(anchorTexts.map((name) => name.trim()).filter(Boolean)),
	]
	if (fromAnchors.length > 0) return fromAnchors
	const text = metaRowText.trim()
	if (!text) return []
	return text
		.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
		.map((s) => s.trim())
		.filter(Boolean)
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

function parseTitle(raw: string): ParsedTitle {
	let working = raw.trim()
	const featuredArtists: string[] = []
	const genres: string[] = []
	let mixType = 'original'

	// 1) Featured: feat./ft./featuring anywhere; with/con only inside parentheses.
	//    The terminator is a lookahead so the main separator dash is NOT consumed:
	//    in "Artist feat. Guest - Song" the " - " has to survive until step 5.
	//    "feat."/"ft." glued to the name with no space ("feat.Ddark") is tolerated.
	working = working.replace(FEAT_RE, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})

	working = working.replace(FEAT_WITH_RE, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})

	// 2) mixType: look for a keyword; prefer the content of the parenthesis/bracket containing it.
	//    The text containing it is noted in `mixTypeText` but NOT removed yet:
	//    step 3 needs to see that parenthesis to catch genres inside it
	//    ("(Deep House Remix)"). It's removed in step 4.
	let mixTypeText = ''
	const bracketMatch = working.match(BRACKET_MIX_RE)
	if (bracketMatch) {
		mixType = bracketMatch[1].trim()
		mixTypeText = bracketMatch[0]
	} else {
		// Without parentheses, only the last segment after a dash counts as a
		// "mix descriptor" ("Artist - Song - Extended Mix"), and only if
		// another dash comes before it: with just one, that last segment *is*
		// the song title ("Artist - Cover Me In Sunshine") and removing it
		// would take the whole song with it.
		const tail = working.match(TAIL_MIX_RE)
		const head = tail ? working.slice(0, tail.index) : ''
		if (tail && SPACED_DASH_RE.test(head)) {
			mixType = tail[1].trim()
			mixTypeText = tail[0]
		} else {
			const bare = working.match(BARE_MIX_RE)
			if (bare) mixType = bare[1].trim()
		}
	}

	// 3) genres: look for whitelist genres inside brackets/parentheses.
	for (const chunk of working.match(BRACKET_CONTENT_RE) || [])
		collectGenres(chunk.slice(1, -1), genres)

	// 4) Strip noise.
	for (const pattern of NOISE_PATTERNS) working = working.replace(pattern, ' ')

	// The mix descriptor is already in `mixType` and its genres were already
	// captured: repeating it inside songTitle only clutters the export.
	if (mixTypeText) working = working.replace(mixTypeText, ' ')

	// Remove brackets/parentheses that only contain genres (already captured).
	working = working.replace(BRACKET_CONTENT_RE, (m, inner: string) =>
		GENRE_MATCHERS.has(inner.trim().toLowerCase()) ? ' ' : m,
	)

	working = working.replace(/\s+/g, ' ').trim()

	// 4b) "|"-separated segments (common format: "Artist - Song | Genre | Label").
	//     All of them contribute genres; only one survives as content.
	const segments = splitPipeSegments(working)
	if (segments.length > 0) {
		for (const seg of segments) collectGenres(seg, genres)
		working = pickPipeMainSegment(segments)
	}

	// 5) Artists + song: split on the main separator.
	//    The dash takes priority (tried first); if there's none, slash or pipe
	//    are accepted as an alternative, requiring surrounding spaces so names
	//    with an inner unspaced "/" aren't split (e.g. "Au/Ra", "AC/DC").
	let artists: string[] = []
	let songTitle = working
	const primaryMatch =
		working.match(DASH_SPLIT_RE) ?? working.match(SLASH_PIPE_SPLIT_RE)
	if (primaryMatch) {
		artists = splitArtists(primaryMatch[1])
		songTitle = primaryMatch[2].trim()
	}

	// Final cleanup of the song title.
	songTitle = songTitle
		.replace(TRAILING_SEPARATOR_RE, '')
		.replace(/\s+/g, ' ')
		.trim()

	// Drop generic genres contained in a more specific one (e.g. "house" when there's "deep house").
	const refinedGenres = genres.filter((g) => {
		const re = GENRE_MATCHERS.get(g)
		if (!re) return true
		return !genres.some((other) => other !== g && re.test(other))
	})

	return { artists, featuredArtists, songTitle, mixType, genres: refinedGenres }
}

// ---------------------------------------------------------------------------
// Tracklist (album/mix descriptions)
// ---------------------------------------------------------------------------

function parseTracklist(description: string): Track[] {
	if (!description) return []
	const lines = description
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)

	// Strategy A: (h:)mm:ss timestamps
	const tsTracks: Track[] = []
	for (const line of lines) {
		const m = line.match(ANY_TS)
		if (!m) continue
		let rest = line.replace(m[0], ' ')
		rest = rest
			.replace(TRACK_LINE_LEAD_JUNK_RE, '')
			.replace(TRACK_LINE_TAIL_JUNK_RE, '')
			.trim()
		rest = rest.replace(TRACK_NUMBER_LEAD_RE, '') // strip leftover leading numbering
		// Strip a residual timestamp only if the original line was a "ts - ts" range
		// (otherwise a title that is a time, e.g. "11:11", would be lost).
		if (RANGE_TS.test(line)) {
			rest = rest.replace(LEADING_TS, '')
		}
		if (rest.length >= 2) {
			tsTracks.push({
				trackIndex: tsTracks.length + 1,
				startTimestamp: m[1],
				rawTrackTitle: rest,
			})
		}
	}
	if (tsTracks.length >= 3) return tsTracks

	// Strategy B: numbered "1. ", "1) ", "1 - "
	const numTracks: Track[] = []
	for (const line of lines) {
		const m = line.match(NUMBERED_LINE_RE)
		if (!m) continue
		// There can be a timestamp at the start ("1. 05:36 Artist - Title"), at
		// the end ("1. Artist - Title 3:45") or on both sides (start and
		// duration). Both are stripped independently and the leading one wins as
		// `startTimestamp`, since it's the one that marks where the track starts.
		let rest = m[2]
		let startTimestamp = ''
		const leadTs = rest.match(NUM_LEAD_TS)
		if (leadTs) {
			startTimestamp = leadTs[1]
			rest = rest.slice(leadTs[0].length).replace(LEADING_DASH_RE, '').trim()
		}
		const tailTs = rest.match(NUM_TAIL_TS)
		if (tailTs) {
			if (!startTimestamp) startTimestamp = tailTs[1]
			rest = rest.slice(0, rest.length - tailTs[0].length)
		}
		rest = rest.trim()
		if (rest.length >= 2) {
			numTracks.push({
				trackIndex: numTracks.length + 1,
				startTimestamp,
				rawTrackTitle: rest,
			})
		}
	}
	if (numTracks.length >= 3) return numTracks

	return []
}

// ---------------------------------------------------------------------------
// Video type classification
// ---------------------------------------------------------------------------

function classifyVideoType(
	rawTitle: string,
	durationSeconds: number,
	longVideoSeconds: number = LONG_VIDEO_SECONDS,
): {
	videoType: VideoType
	isCandidate: boolean
} {
	const lower = rawTitle.toLowerCase()
	const isLong = durationSeconds >= longVideoSeconds
	const hasAlbumKw = ALBUM_KEYWORDS.some((k) => lower.includes(k))
	const hasMixKw = MIX_KEYWORDS.some((k) =>
		new RegExp(`\\b${k}\\b`).test(lower),
	)

	// Only long videos are opened to extract a tracklist: if none shows up, the
	// video falls back to a single song on its own. But "long" isn't enough to
	// *label* it an album or a mix — a 25-minute extended track or concert with
	// no keyword is neither, and it came out wrong in the export.
	if (isLong) {
		const videoType = hasAlbumKw ? 'album' : hasMixKw ? 'mix' : 'single'
		return { videoType, isCandidate: true }
	}
	// Short videos with an album/mix keyword are still labeled, but not expanded.
	if (hasAlbumKw) return { videoType: 'album', isCandidate: false }
	if (hasMixKw) return { videoType: 'mix', isCandidate: false }
	return { videoType: 'single', isCandidate: false }
}

// ---------------------------------------------------------------------------
// Post-processing of the raw videos
// ---------------------------------------------------------------------------

/**
 * Turns a source's raw videos into domain videos, deriving what's computed the
 * same way wherever they came from: duration in seconds, video type and the
 * resolved channel(s).
 *
 * It lives here and not in `sources/` on purpose: it's the step that keeps the
 * rest of the pipeline from having to know whether the data came from the DOM
 * or from an API. It's pure and doesn't mutate its input.
 */
function toPlaylistVideos(
	raw: RawPlaylistVideo[],
	longVideoSeconds: number = LONG_VIDEO_SECONDS,
): PlaylistVideo[] {
	return raw.map(({ chanAnchorTexts, metaRowText, ...rest }) => {
		const durationSeconds = durationToSeconds(rest.duration)
		// An unavailable video isn't classified: running the heuristics over a
		// "[Private video]" would only produce made-up labels.
		const { videoType, isCandidate } =
			rest.availability === 'available'
				? classifyVideoType(rest.rawTitle, durationSeconds, longVideoSeconds)
				: { videoType: 'unknown' as const, isCandidate: false }
		return {
			...rest,
			channel: resolveChannelNames(chanAnchorTexts, metaRowText),
			durationSeconds,
			videoType,
			isCandidate,
		}
	})
}

// ---------------------------------------------------------------------------
// Flattening into song rows
// ---------------------------------------------------------------------------

function videoToSong(v: PlaylistVideo): Song {
	if (v.availability === 'unavailable') {
		return {
			position: String(v.index),
			artists: [],
			featuredArtists: [],
			songTitle: v.rawTitle || t('output.unavailableTitle'),
			mixType: '',
			genres: [],
			rawTitle: v.rawTitle,
			channel: v.channel,
			videoType: v.videoType,
			availability: v.availability,
			duration: v.duration,
			videoId: v.videoId,
			url: v.url,
			thumbnail: v.thumbnail,
			parentVideoId: '',
			startTimestamp: '',
		}
	}
	const parsed = parseTitle(v.rawTitle)
	return {
		position: String(v.index),
		artists: parsed.artists.length > 0 ? parsed.artists : v.channel,
		featuredArtists: parsed.featuredArtists,
		songTitle: parsed.songTitle,
		mixType: parsed.mixType,
		genres: parsed.genres,
		rawTitle: v.rawTitle,
		channel: v.channel,
		videoType: v.videoType,
		availability: v.availability,
		duration: v.duration,
		videoId: v.videoId,
		url: v.url,
		thumbnail: v.thumbnail,
		parentVideoId: '',
		startTimestamp: '',
	}
}

function trackToSong(v: PlaylistVideo, track: Track): Song {
	const parsed = parseTitle(track.rawTrackTitle)
	const url = track.startTimestamp
		? `${v.url}&t=${durationToSeconds(track.startTimestamp)}`
		: v.url
	return {
		position: `${v.index}.${track.trackIndex}`,
		artists: parsed.artists.length > 0 ? parsed.artists : v.channel,
		featuredArtists: parsed.featuredArtists,
		songTitle: parsed.songTitle,
		mixType: parsed.mixType,
		genres: parsed.genres,
		rawTitle: track.rawTrackTitle,
		channel: v.channel,
		videoType: v.videoType,
		availability: 'available',
		duration: '',
		videoId: v.videoId,
		url,
		thumbnail: v.thumbnail,
		parentVideoId: v.videoId,
		startTimestamp: track.startTimestamp,
	}
}

function buildSongRows(
	videos: PlaylistVideo[],
	tracklists: Map<string, Track[]>,
): Song[] {
	const songs: Song[] = []
	for (const v of videos) {
		const tracks = tracklists.get(v.videoId)
		if (v.isCandidate && tracks && tracks.length > 0) {
			for (const track of tracks) songs.push(trackToSong(v, track))
		} else {
			songs.push(videoToSong(v))
		}
	}
	return songs
}

/**
 * Drops repeated songs, keeping the first occurrence.
 *
 * The key is `videoId` + `startTimestamp` and not just the videoId: the tracks
 * of an expanded album/mix share the source video and all but the first would
 * be lost. Songs with no videoId (private/deleted videos) are never deduped
 * against each other: there's nothing to tell them apart by.
 */
function dedupeSongs(songs: Song[]): Song[] {
	const seen = new Set<string>()
	return songs.filter((s) => {
		if (!s.videoId) return true
		const key = `${s.videoId}|${s.startTimestamp}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

/**
 * Applies the config's optional filters (`null` = no filter). The genre filter
 * accepts a song if it has *any* of the requested genres.
 */
function applySongFilters(
	songs: Song[],
	filters: {
		videoTypeFilter: VideoType[] | null
		genreFilter: string[] | null
		excludeUnavailable: boolean
	},
): Song[] {
	const { videoTypeFilter, genreFilter, excludeUnavailable } = filters
	const wantedGenres = genreFilter?.map((g) => g.toLowerCase()) ?? null
	return songs.filter((s) => {
		if (excludeUnavailable && s.availability === 'unavailable') return false
		if (videoTypeFilter && !videoTypeFilter.includes(s.videoType as VideoType))
			return false
		if (
			wantedGenres &&
			!s.genres.some((g) => wantedGenres.includes(g.toLowerCase()))
		)
			return false
		return true
	})
}

const byTitleAsc = (a: Song, b: Song): number =>
	a.songTitle.localeCompare(b.songTitle, undefined, { sensitivity: 'base' })

/** Applies the chosen order (extra option) and renumbers `position` if it's no longer the original. */
function applySongOrder(songs: Song[], order: SongOrder): Song[] {
	if (order === 'original') return songs
	let ordered: Song[]
	switch (order) {
		case 'reverse':
			ordered = songs.toReversed()
			break
		case 'alphabetical-asc':
			ordered = songs.toSorted((a, b) => byTitleAsc(a, b))
			break
		case 'alphabetical-desc':
			ordered = songs.toSorted((a, b) => byTitleAsc(b, a))
			break
		case 'shuffle':
			ordered = shuffle(songs)
			break
	}
	return ordered.map((s, i) => ({ ...s, position: String(i + 1) }))
}

// ---------------------------------------------------------------------------
// Exporters
// ---------------------------------------------------------------------------

function flattenForTable(
	song: Song,
	columns: Column[],
): Record<string, string> {
	const row: Record<string, string> = {}
	for (const col of columns) {
		const value = song[col.key]
		row[col.key] = Array.isArray(value) ? value.join('; ') : String(value ?? '')
	}
	return row
}

/** Projects a song onto only the selected keys (for the JSON). */
function projectSong(song: Song, columns: Column[]): Partial<Song> {
	const out: Partial<Song> = {}
	for (const col of columns) {
		;(out[col.key] as Song[keyof Song]) = song[col.key]
	}
	return out
}

/**
 * Avoids overwriting a previous run: the timestamp has one-second resolution,
 * and `mkdir(recursive)` doesn't fail if the folder already exists, so two
 * back-to-back extractions of the same playlist silently overwrote the first
 * one's files. Returns the free path (`…_2`, `…_3`, …).
 */
function uniqueOutDir(base: string): string {
	let candidate = base
	for (let n = 2; existsSync(candidate); n++) candidate = `${base}_${n}`
	return candidate
}

async function writeOutputs({
	songs,
	outDir,
	playListName,
	formats,
	columns,
}: {
	songs: Song[]
	outDir: string
	playListName: string
	formats: Set<Format>
	columns: (keyof Song)[]
}): Promise<void> {
	// Selected columns, in the order the user chose. A key that doesn't exist
	// is dropped instead of substituted: it used to fall back to COLUMNS[0] and
	// produce a duplicate "position" column without any warning.
	const byKey = new Map(COLUMNS.map((c) => [c.key, c]))
	const selectedColumns = columns
		.map((k) => byKey.get(k))
		.filter((c): c is Column => c !== undefined)
	if (selectedColumns.length === 0)
		throw new Error(
			'writeOutputs: ninguna de las columnas pedidas existe en COLUMNS',
		)
	await mkdir(outDir, { recursive: true })

	// JSON (native arrays), projected onto the selected columns.
	if (formats.has('json')) {
		await writeFile(
			path.join(outDir, 'playlist.json'),
			JSON.stringify(
				{
					name: playListName,
					total: songs.length,
					songs: songs.map((s) => projectSong(s, selectedColumns)),
				},
				null,
				2,
			),
			'utf8',
		)
	}

	// Workbook shared by XLSX and CSV (arrays as text).
	if (formats.has('xlsx') || formats.has('csv')) {
		const wb = new ExcelJS.Workbook()
		const ws = wb.addWorksheet(t('output.sheetName'))
		// Translated header, canonical key: what's visible changes with the
		// language, the data doesn't.
		ws.columns = selectedColumns.map((c) => ({
			header: columnHeader(c.key),
			key: c.key as string,
			width: c.width,
		}))
		ws.addRows(songs.map((s) => flattenForTable(s, selectedColumns)))
		ws.getRow(1).font = { bold: true }
		ws.views = [{ state: 'frozen', ySplit: 1 }]

		if (formats.has('xlsx'))
			await wb.xlsx.writeFile(path.join(outDir, 'playlist.xlsx'))
		if (formats.has('csv'))
			await wb.csv.writeFile(path.join(outDir, 'playlist.csv'))
	}
}

// ---------------------------------------------------------------------------
// Extraction (orchestration)
// ---------------------------------------------------------------------------

/**
 * Runs a full extraction according to `config`: asks the source for the
 * playlist, (optionally) expands albums/mixes and writes the files. Returns the
 * number of songs and the output folder.
 *
 * If `session` is passed it's reused (and not closed here); otherwise it opens
 * its own, which is closed when done.
 */
export async function runExtraction(
	config: ExtractConfig,
	session?: ScrapeSession,
): Promise<{ count: number; outDir: string }> {
	const {
		fullUrl,
		allVideos,
		maxVideos,
		formats,
		expandAlbums,
		columns,
		songOrder,
		excludeUnavailable,
		longVideoSeconds,
		dedupe,
		videoTypeFilter,
		genreFilter,
	} = config
	if (!fullUrl.trim())
		throw new Error('runExtraction: fullUrl no puede estar vacío')
	if (formats.size === 0)
		throw new Error(
			'runExtraction: formats no puede estar vacío (elige al menos json, csv o xlsx)',
		)
	if (columns.length === 0)
		throw new Error(
			'runExtraction: columns no puede estar vacío (elige al menos una columna)',
		)
	const log = config.onProgress ?? console.log

	// The validation above runs BEFORE opening anything: an invalid config has
	// no reason to cost a Chromium launch.
	let ownSession: ScrapeSession | null = null
	try {
		let source: ScrapeSession
		if (session) {
			source = session
		} else {
			log(t('extract.openingBrowser'))
			ownSession = await openScrapeSession()
			source = ownSession
		}

		log(t('extract.reading'))
		const payload = await source.fetchPlaylist(
			fullUrl,
			allVideos ? null : maxVideos,
		)
		const { title, channel } = payload
		const videos = toPlaylistVideos(payload.videos, longVideoSeconds)
		log(t('extract.found', { count: videos.length, title }))
		// With no videos there's nothing to export: writing anyway left folders
		// with `total: 0` that looked like a successful run.
		if (videos.length === 0) throw new Error(t('errors.emptyPlaylist'))

		// Candidates' tracklists (albums/mixes), only if enabled.
		const candidates = expandAlbums ? videos.filter((v) => v.isCandidate) : []
		const tracklists = new Map<string, Track[]>()
		if (candidates.length > 0) {
			log(t('extract.candidates', { count: candidates.length }))
			for (const v of candidates) {
				// A failing video doesn't take down the whole run: warn and move on.
				// The source throws the error; deciding it isn't fatal is the
				// orchestrator's call.
				let tracks: Track[] = []
				try {
					tracks = parseTracklist(await source.readDescription(v.videoId))
				} catch (err) {
					console.warn(
						t('extract.descriptionFailed', {
							videoId: v.videoId,
							message: (err as Error).message,
						}),
					)
				}
				const title = v.rawTitle.slice(0, 50)
				if (tracks.length > 0) {
					tracklists.set(v.videoId, tracks)
					log(t('extract.tracks', { count: tracks.length, title }))
				} else {
					log(t('extract.noTracklist', { title }))
				}
				await sleep(POLITE_SLEEP_MS) // be polite to the server
			}
		}

		// Dedupe before filtering (cheaper), and the order last so that the
		// `position` renumbering reflects what actually gets exported.
		let songs = buildSongRows(videos, tracklists)
		if (dedupe) songs = dedupeSongs(songs)
		songs = applySongFilters(songs, {
			videoTypeFilter,
			genreFilter,
			excludeUnavailable,
		})
		songs = applySongOrder(songs, songOrder)
		const stamp = dayjs().format('YYYY-MM-DD_HH-mm-ss')
		// If the title is generic (e.g. "Videos"), the channel is enough to
		// recognize the folder; otherwise the channel is prepended to the title.
		const genericTitle = GENERIC_PLAYLIST_TITLES.test(title.trim())
		const playListName = genericTitle ? channel : `${channel}-${title}`
		const outDir = uniqueOutDir(
			path.join(
				process.cwd(),
				'output',
				`${sanitizeFilename(playListName)}_${stamp}`,
			),
		)
		await writeOutputs({ songs, outDir, playListName, formats, columns })

		const files = [...formats].map((f) => `playlist.${f}`).join(', ')
		log(t('extract.done', { count: songs.length }))
		log(
			t('extract.outputPath', {
				dir: path.relative(process.cwd(), outDir),
				files,
			}),
		)
		return { count: songs.length, outDir }
	} finally {
		if (ownSession) await ownSession.close()
	}
}

// Exports the pure functions for tests.
export {
	applySongFilters,
	applySongOrder,
	buildSongRows,
	classifyVideoType,
	dedupeSongs,
	flattenForTable,
	parseTitle,
	parseTracklist,
	projectSong,
	resolveChannelNames,
	toPlaylistVideos,
	trackToSong,
	videoToSong,
}
