import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	LONG_VIDEO_SECONDS,
} from '../../src/types.ts'

/**
 * A complete `ExtractConfig` for tests, with the same defaults as `cli.ts`'s
 * `defaultConfig()` but without reading the store or prompting.
 */
export default function makeConfig(
	overrides: Partial<ExtractConfig>,
): ExtractConfig {
	return {
		fullUrl: 'https://youtube.com/playlist?list=TEST',
		allVideos: true,
		maxVideos: 50,
		formats: new Set([...FORMATS]),
		expandAlbums: true,
		columns: COLUMNS.map((c) => c.key),
		songOrder: 'original',
		excludeUnavailable: false,
		longVideoSeconds: LONG_VIDEO_SECONDS,
		dedupe: false,
		videoTypeFilter: null,
		genreFilter: null,
		...overrides,
	}
}
