/**
 * Shared types and constants of the playlist extractor.
 *
 * This is where the domain types (videos, tracks, songs, config) and the pure
 * data constants live: output formats/columns, heuristic keywords and the
 * timestamp grammar. The logic lives in `extractor.ts`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A video as handed over by a *source* (`sources/`): raw signals only, nothing
 * derived. The channel comes unresolved (the anchors on one side, the metadata
 * row's text on the other) because choosing between them is the job of
 * `resolveChannelNames`, which lives in the processing layer and has no access
 * to the browser context.
 *
 * `availability` is decided by the source, even if it looks like a heuristic:
 * the literal "[Private video]"/"[Deleted video]" titles are an artifact of how
 * YouTube renders the page, and the API reports it some other way. Each source
 * detects it its own way and hands over the answer already normalized.
 */
export interface RawPlaylistVideo {
	index: number // 1-based position within the playlist
	rawTitle: string
	chanAnchorTexts: string[] // texts of the channel anchors (the normal case)
	metaRowText: string // plain metadata text (collaboration videos)
	videoId: string
	url: string
	thumbnail: string
	duration: string
	availability: 'available' | 'unavailable'
}

/**
 * A video already processed by `toPlaylistVideos`: the raw data (minus the
 * unresolved signals) plus what's derived from it. Everything added here is
 * computed the same way wherever the video came from, so it doesn't depend on
 * the source.
 */
export interface PlaylistVideo
	extends Omit<RawPlaylistVideo, 'chanAnchorTexts' | 'metaRowText'> {
	channel: string[] // one or more owner channels (YouTube collaborations)
	durationSeconds: number
	videoType: VideoType
	isCandidate: boolean
}

/**
 * What any source returns when asked for a playlist. It's the only contract
 * shared by today's scraping and the future YouTube Data API: raw,
 * uninterpreted data.
 */
export interface PlaylistPayload {
	title: string
	channel: string
	videos: RawPlaylistVideo[]
}

export interface Track {
	trackIndex: number
	startTimestamp: string
	rawTrackTitle: string
}

export interface ParsedTitle {
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
}

export interface Song {
	position: string
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
	rawTitle: string
	channel: string[]
	videoType: string
	availability: string
	duration: string
	videoId: string
	url: string
	thumbnail: string
	parentVideoId: string
	startTimestamp: string
}

/**
 * File formats the extraction can produce (single source of truth).
 * The visible labels live in `locales/` (`formatLabel` in `i18n.ts`).
 */
export const FORMATS = ['json', 'csv', 'xlsx'] as const
export type Format = (typeof FORMATS)[number]

/**
 * Song order modes (experimental option, single source of truth).
 * The visible labels live in `locales/` (`songOrderLabel` in `i18n.ts`).
 */
export const SONG_ORDERS = [
	'original',
	'reverse',
	'alphabetical-asc',
	'alphabetical-desc',
	'shuffle',
] as const
export type SongOrder = (typeof SONG_ORDERS)[number]

/** Video type as classified by `classifyVideoType` (single source of truth). */
export const VIDEO_TYPES = ['single', 'album', 'mix', 'unknown'] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

/**
 * Groups of the "Extraction options" menu (single source of truth): everything
 * that changes **what** ends up in the result. What only changes how the
 * program behaves goes in Settings, not here.
 * The visible labels live in `locales/` (`menu.groups.<key>`, `menu.<option>`).
 */
export const EXTRACTION_GROUPS = [
	{ key: 'source', options: ['url', 'max'] },
	{ key: 'output', options: ['formats', 'columns', 'columnOrder'] },
	{
		key: 'songs',
		options: [
			'expand',
			'longVideo',
			'songOrder',
			'excludeUnavailable',
			'dedupe',
			'videoTypeFilter',
			'genreFilter',
		],
	},
] as const
export type ExtractionOption =
	(typeof EXTRACTION_GROUPS)[number]['options'][number]

/** An extraction's config, adjustable from the CLI. */
export interface ExtractConfig {
	fullUrl: string
	allVideos: boolean // true = process all of them (ignores maxVideos)
	maxVideos: number // integer limit ≥ 1, only when allVideos is false
	formats: Set<Format>
	expandAlbums: boolean
	columns: (keyof Song)[] // subset of the COLUMNS keys, in the desired output order
	songOrder: SongOrder // default 'original' (extra option, off by default)
	excludeUnavailable: boolean // default false (extra option, off by default)
	longVideoSeconds: number // "long video" threshold (default LONG_VIDEO_SECONDS)
	dedupe: boolean // default false: drops repeated songs
	videoTypeFilter: VideoType[] | null // null = no filter
	genreFilter: string[] | null // null = no filter
	onProgress?: (message: string) => void // default: console.log
}

export interface YoutubePageHTML extends Window {
	ytInitialPlayerResponse: {
		videoDetails: {
			shortDescription: string
		}
	}
	ytInitialData: {
		metadata: {
			playlistMetadataRenderer: {
				title: string
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Output columns
// ---------------------------------------------------------------------------

/**
 * Output columns in their canonical order. The `key` is the domain one (`Song`)
 * and doesn't change with the language; the visible header is resolved by
 * `i18n.ts`'s `columnHeader` against `columns.<key>` in `locales/`.
 */
export const COLUMNS: { key: keyof Song; width: number }[] = [
	{ key: 'position', width: 10 },
	{ key: 'artists', width: 28 },
	{ key: 'featuredArtists', width: 22 },
	{ key: 'songTitle', width: 34 },
	{ key: 'mixType', width: 16 },
	{ key: 'genres', width: 18 },
	{ key: 'rawTitle', width: 42 },
	{ key: 'channel', width: 24 },
	{ key: 'videoType', width: 14 },
	{ key: 'availability', width: 14 },
	{ key: 'duration', width: 10 },
	{ key: 'videoId', width: 14 },
	{ key: 'url', width: 44 },
	{ key: 'thumbnail', width: 44 },
	{ key: 'parentVideoId', width: 14 },
	{ key: 'startTimestamp', width: 12 },
]

export type Column = (typeof COLUMNS)[number]

// ---------------------------------------------------------------------------
// Heuristic constants
// ---------------------------------------------------------------------------

/** Duration (s) from which a video is considered an album/mix candidate. */
export const LONG_VIDEO_SECONDS = 18 * 60

export const ALBUM_KEYWORDS = [
	'full album',
	'album completo',
	'álbum completo',
	'full ep',
	'the album',
	'disco completo',
]
export const MIX_KEYWORDS = [
	'mixtape',
	'megamix',
	'dj set',
	'compilation',
	'continuous mix',
	'podcast',
	'live set',
	// Note: don't include a bare 'mix': it over-classifies single-song tracks
	// like "(Extended Mix)", "(VIP Mix)", "(Original Mix)" (false DJ sets).
]

/** Words that indicate a mix type (not the original song). */
export const MIX_TYPE_KEYWORDS = [
	'remix',
	'bootleg',
	'edit',
	'flip',
	'mashup',
	'mash-up',
	'vip',
	'rework',
	'refix',
	'cover',
	'remaster',
	'remastered',
	'extended mix',
	'extended',
	'club mix',
	'radio edit',
	'instrumental',
	'acoustic',
	'acapella',
	'a cappella',
	'slowed',
	'sped up',
	'nightcore',
]

/** Genre whitelist, to detect them in the title's brackets/parentheses. */
export const GENRE_KEYWORDS = [
	'drum & bass',
	'drum and bass',
	'dnb',
	'd&b',
	'deep house',
	'future house',
	'tech house',
	'progressive house',
	'electro house',
	'bass house',
	'slap house',
	'big room',
	'future bass',
	'melodic dubstep',
	'melodic bass',
	'color bass',
	'colour bass',
	'future garage',
	'uk garage',
	'hard techno',
	'hard house',
	'hardstyle',
	'hardcore',
	'happy hardcore',
	'psytrance',
	'trance',
	'techno',
	'house',
	'dubstep',
	'riddim',
	'trap',
	'edm',
	'synthwave',
	'lo-fi',
	'lofi',
	'chillstep',
	'chillout',
	'ambient',
	'downtempo',
	'breakbeat',
	'jungle',
	'phonk',
	'brazilian phonk',
	'hyperpop',
	'hip hop',
	'hip-hop',
	'rap',
	'r&b',
	'pop',
	'rock',
	'indie',
	'metal',
	'reggaeton',
	'reggae',
	'latin',
	'salsa',
	'cumbia',
	'jazz',
	'funk',
	'soul',
	'disco',
	'garage',
]

/** "Noise" tags to strip from the title. */
export const NOISE_PATTERNS: RegExp[] = [
	/\(\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\)/gi,
	/\[\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\]/gi,
	/\(\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\)/gi,
	/\[\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\]/gi,
	/[([]\s*(?:hd|hq|4k|8k|m\/v|mv|free\s+download|free\s+dl|out\s+now)\s*[)\]]/gi,
]

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

/**
 * Dashes accepted as the "artist - song" separator.
 *
 * The ASCII hyphen and the typographic ones (en dash, em dash) aren't enough:
 * some fonts/copy-pastes bring HYPHEN (U+2010), NON-BREAKING HYPHEN (U+2011),
 * FIGURE DASH (U+2012) or MINUS SIGN (U+2212), visually identical. If one is
 * missing, the whole title ends up as a song name with no artist.
 *
 * The `-` is escaped so this string can be interpolated at any position of a
 * `[...]` without being read as a range (`[.)-‐]` would be the range
 * `)`–`‐`, which swallows digits and letters).
 */
export const DASH_CHARS = '\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212'

/** Character class ready to interpolate into a regex. */
export const DASH_CLASS = `[${DASH_CHARS}]`

/** A track's numbering in a tracklist ("1.", "12)", "100 - "). */
export const TRACK_NUMBER_PATTERN = `\\d{1,3}\\s*[.)${DASH_CHARS}]`

// ---------------------------------------------------------------------------
// Timestamp grammar
// ---------------------------------------------------------------------------

/** Shared grammar of a "(h:)mm:ss" timestamp (source of the regexes below). */
export const TS_PATTERN = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}'

/** Timestamp at the start of a track's text, with optional parentheses/dash. */
export const LEADING_TS = new RegExp(
	`^[([]?(${TS_PATTERN})[)\\]]?\\s*[${DASH_CHARS}.]?\\s*`,
)

/** A line that opens with a "ts - ts" timestamp range (e.g. "0:00 - 5:36 …"). */
export const RANGE_TS = new RegExp(
	`^[([]?${TS_PATTERN}[)\\]]?\\s*${DASH_CLASS}\\s*[([]?${TS_PATTERN}[)\\]]?`,
)

/** First timestamp anywhere in the line. */
export const ANY_TS = new RegExp(`(${TS_PATTERN})`)

/** Timestamp at the start of a numbered track, delimited. */
export const NUM_LEAD_TS = new RegExp(
	`^\\s*[([]?(${TS_PATTERN})[)\\]]?(?=\\s|${DASH_CLASS}|$)`,
)

/** Timestamp at the end of a numbered track. */
export const NUM_TAIL_TS = new RegExp(`\\s*[([]?(${TS_PATTERN})[)\\]]?\\s*$`)

// ---------------------------------------------------------------------------
// YouTube DOM (shared with debug-dom.ts)
// ---------------------------------------------------------------------------

/**
 * The scraper's selectors. They live here (and not in `sources/scrape.ts`)
 * because `debug-dom.ts` exists precisely to diagnose when YouTube changes its
 * markup: if each file had its own copy, the debug script could end up looking
 * at old selectors and report a DOM the real scraper no longer uses.
 *
 * Since they're used inside `page.evaluate` (browser context, with no access to
 * Node imports), they have to be passed explicitly as an argument.
 */
export const YT_SELECTORS = {
	/** Old Polymer variant: strict container of the real content. */
	listRenderer: 'ytd-playlist-video-list-renderer',
	/** The page's sections; the first is the playlist, the rest are recommendations. */
	sections: 'yt-item-section-renderer, ytd-item-section-renderer',
	/**
	 * The same sections in order of preference. The new variant wins over the
	 * old one even if it appears later in the document, which is what a
	 * `querySelector(a) || querySelector(b)` does and a comma selector doesn't.
	 */
	sectionsByPreference: [
		'yt-item-section-renderer',
		'ytd-item-section-renderer',
	],
	/** A playlist item, in either of the two UI variants. */
	items: 'yt-lockup-view-model, ytd-playlist-video-renderer',
	/** Link to the video inside an item (carries the title and videoId). */
	itemTitleLink: 'h3 a',
	header: 'yt-page-header-renderer, ytd-playlist-header-renderer',
	title:
		'yt-dynamic-sizing-formatted-string, #title yt-formatted-string, h1 .ytPageHeaderViewModelTitle',
	metadataRow: '.ytContentMetadataViewModelMetadataRow',
	/** Each text piece of a metadata row (a channel name, "and X"...). */
	metadataText: '.ytContentMetadataViewModelMetadataText',
	durationBadge: 'yt-thumbnail-badge-view-model',
	description: '#description-inline-expander, #description',
} as const

/** Scopes in order of preference (the strict one first). */
export const YT_SCOPE_SELECTORS = [
	YT_SELECTORS.listRenderer,
	'yt-item-section-renderer',
	'ytd-item-section-renderer',
]

/**
 * Detects a channel `href`. Stored as a *string* and not as a RegExp because it
 * has to cross into `page.evaluate`, which serializes its arguments to JSON.
 */
export const CHANNEL_HREF_SOURCE = '/(@|channel/|c/|user/)'

export const CHANNEL_HREF_RE = new RegExp(CHANNEL_HREF_SOURCE)

/** Desktop Chrome UA: YouTube serves different markup to a headless with no UA. */
export const DESKTOP_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Playlist titles so generic that on their own they don't identify the output
 * folder: in those cases the channel name is enough.
 */
export const GENERIC_PLAYLIST_TITLES =
	/^(videos|playlist|mix|favoritos|favorites)$/i

// ---------------------------------------------------------------------------
// Scraper timings
// ---------------------------------------------------------------------------

/** Navigation timeout for the playlist page. */
export const PLAYLIST_NAV_TIMEOUT_MS = 60_000
/** Navigation timeout for a video's page (tracklist). */
export const VIDEO_NAV_TIMEOUT_MS = 45_000
/** Maximum wait for the playlist's first item to appear. */
export const CONTENT_TIMEOUT_MS = 30_000
/** Wait for the video description to hydrate before reading it. */
export const DESCRIPTION_SETTLE_MS = 1_200
/** Timeout of the click on the cookie consent button. */
export const CONSENT_CLICK_TIMEOUT_MS = 5_000
/** Wait after accepting the consent, while YouTube reloads the view. */
export const CONSENT_SETTLE_MS = 1_000
/** Maximum iterations of the lazy-load scroll (stops an infinite scroll). */
export const SCROLL_MAX_ITERATIONS = 400
/** Consecutive rounds with no new items to consider the scroll done. */
export const SCROLL_STABLE_ROUNDS = 3
/** Pause between scrolls so YouTube manages to render the new batch. */
export const SCROLL_SLEEP_MS = 700
/** Pause between videos when fetching tracklists: being polite to the server. */
export const POLITE_SLEEP_MS = 600
