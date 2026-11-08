/**
 * The user's persisted preferences (language, last-used config and recent
 * URLs).
 *
 * Wraps `conf` so the rest of the code doesn't depend on its API. The store is
 * created lazily: importing this module must not touch the disk (the tests
 * spawn `src/index.ts`). `PLAYLIST_CONFIG_DIR` points the store at a temporary
 * directory in tests.
 *
 * Everything stored goes through `sanitizeConfig` when read back: a file
 * written by an older version may carry columns or formats that no longer
 * exist, and using them as is would silently break the output.
 */

import Conf from 'conf'
import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	type Format,
	SONG_ORDERS,
	type Song,
	type SongOrder,
	VIDEO_TYPES,
	type VideoType,
} from './types.ts'

/** How many playlist URLs are remembered to offer them in the menu. */
const MAX_RECENT_URLS = 10

/**
 * Config as serialized to JSON: `formats` travels as an array because a `Set`
 * doesn't survive the round-trip, and `fullUrl`/`onProgress` aren't stored (one
 * lives in `recentUrls`, the other is a function).
 */
export interface PersistedConfig {
	allVideos: boolean
	maxVideos: number
	formats: Format[]
	expandAlbums: boolean
	columns: (keyof Song)[]
	songOrder: SongOrder
	excludeUnavailable: boolean
	longVideoSeconds: number
	dedupe: boolean
	videoTypeFilter: VideoType[] | null
	genreFilter: string[] | null
}

interface StoreShape {
	locale?: string
	lastConfig?: PersistedConfig
	recentUrls?: string[]
}

let store: Conf<StoreShape> | null = null

function getStore(): Conf<StoreShape> {
	store ??= new Conf<StoreShape>({
		projectName: 'playlist-extractor',
		cwd: process.env.PLAYLIST_CONFIG_DIR || undefined,
	})
	return store
}

/** Locale saved by a previous run, or `undefined` if one was never chosen. */
export function getSavedLocale(): string | undefined {
	return getStore().get('locale')
}

export function setSavedLocale(locale: string): void {
	getStore().set('locale', locale)
}

/** `false` the first time the CLI is opened: triggers the language prompt. */
export function hasSavedLocale(): boolean {
	return getStore().has('locale')
}

/** Path of the config file (to show it in the CLI). */
export function configPath(): string {
	return getStore().path
}

// ---------------------------------------------------------------------------
// Last-used config
// ---------------------------------------------------------------------------

const isValidArray = <T>(value: unknown, allowed: readonly T[]): value is T[] =>
	Array.isArray(value) && value.every((v) => allowed.includes(v as T))

/**
 * Drops from the stored object everything the current version doesn't
 * recognize and returns only the valid keys, to be merged over the defaults.
 */
export function sanitizeConfig(
	raw: Partial<PersistedConfig> | undefined,
): Partial<PersistedConfig> {
	if (!raw || typeof raw !== 'object') return {}
	const out: Partial<PersistedConfig> = {}
	const columnKeys = COLUMNS.map((c) => c.key)

	if (typeof raw.allVideos === 'boolean') out.allVideos = raw.allVideos
	if (Number.isInteger(raw.maxVideos) && (raw.maxVideos as number) >= 1)
		out.maxVideos = raw.maxVideos
	if (typeof raw.expandAlbums === 'boolean') out.expandAlbums = raw.expandAlbums
	if (typeof raw.excludeUnavailable === 'boolean')
		out.excludeUnavailable = raw.excludeUnavailable
	if (typeof raw.dedupe === 'boolean') out.dedupe = raw.dedupe
	if (
		Number.isInteger(raw.longVideoSeconds) &&
		(raw.longVideoSeconds as number) >= 1
	)
		out.longVideoSeconds = raw.longVideoSeconds
	if (raw.songOrder && SONG_ORDERS.includes(raw.songOrder))
		out.songOrder = raw.songOrder

	// Lists are filtered instead of dropped whole: if a single column
	// disappeared, the rest of the chosen order is still valid.
	if (Array.isArray(raw.formats)) {
		const formats = raw.formats.filter((f): f is Format =>
			FORMATS.includes(f as Format),
		)
		if (formats.length > 0) out.formats = formats
	}
	if (Array.isArray(raw.columns)) {
		const columns = raw.columns.filter((c) => columnKeys.includes(c))
		if (columns.length > 0) out.columns = columns
	}
	if (raw.videoTypeFilter === null) out.videoTypeFilter = null
	else if (isValidArray(raw.videoTypeFilter, VIDEO_TYPES))
		out.videoTypeFilter = raw.videoTypeFilter
	if (raw.genreFilter === null) out.genreFilter = null
	else if (
		Array.isArray(raw.genreFilter) &&
		raw.genreFilter.every((g) => typeof g === 'string')
	)
		out.genreFilter = raw.genreFilter

	return out
}

/** Config of the last run, already sanitized. Empty if nothing was ever saved. */
export function getSavedConfig(): Partial<PersistedConfig> {
	return sanitizeConfig(getStore().get('lastConfig'))
}

/** Saves an extraction's config (without the URL, which goes to `recentUrls`). */
export function setSavedConfig(config: ExtractConfig): void {
	const persisted: PersistedConfig = {
		allVideos: config.allVideos,
		maxVideos: config.maxVideos,
		formats: [...config.formats],
		expandAlbums: config.expandAlbums,
		columns: config.columns,
		songOrder: config.songOrder,
		excludeUnavailable: config.excludeUnavailable,
		longVideoSeconds: config.longVideoSeconds,
		dedupe: config.dedupe,
		videoTypeFilter: config.videoTypeFilter,
		genreFilter: config.genreFilter,
	}
	getStore().set('lastConfig', persisted)
}

// ---------------------------------------------------------------------------
// Recent URLs
// ---------------------------------------------------------------------------

export function getRecentUrls(): string[] {
	const raw = getStore().get('recentUrls')
	if (!Array.isArray(raw)) return []
	return raw
		.filter((u) => typeof u === 'string' && u.trim())
		.slice(0, MAX_RECENT_URLS)
}

/** Adds a URL to the history: most recent first, no duplicates. */
export function pushRecentUrl(url: string): void {
	const clean = url.trim()
	if (!clean) return
	const next = [clean, ...getRecentUrls().filter((u) => u !== clean)].slice(
		0,
		MAX_RECENT_URLS,
	)
	getStore().set('recentUrls', next)
}
