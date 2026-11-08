/**
 * Entry point of the YouTube playlist extractor.
 *
 * With no arguments it opens the interactive menu (needs a TTY). With a URL as
 * the first argument it runs in non-interactive quick mode:
 *   node src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *   bun  src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *
 * The language is resolved before printing anything: `--lang=<code>` (or
 * `--locale`) and `PLAYLIST_LANG` work in both modes; in interactive mode it's
 * asked the first time and the choice is saved with `conf`.
 */

import { fileURLToPath } from 'node:url'
import { defaultConfig, interactiveMenu, promptFirstRunLocale } from './cli.ts'
import { getSavedLocale, hasSavedLocale } from './config.ts'
import { runExtraction } from './extractor.ts'
import {
	changeLocale,
	initI18n,
	resolveLocale,
	supportedLocales,
	t,
} from './i18n.ts'
import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	SONG_ORDERS,
	VIDEO_TYPES,
} from './types.ts'
import {
	normalizeUrl,
	osLocale,
	parseFlags,
	parseLangFlag,
	parsePositiveInt,
} from './utils.ts'

// ---------------------------------------------------------------------------
// Quick mode via arguments (backwards compatibility)
// ---------------------------------------------------------------------------

/**
 * Flags that accept `--flag value` besides `--flag=value`. Booleans are left out
 * on purpose: otherwise `--dedupe "URL"` would swallow the URL.
 */
const VALUE_FLAGS = [
	'lang',
	'locale',
	'formats',
	'columns',
	'song-order',
	'long-video-minutes',
	'video-types',
	'genres',
]

/** Boolean flags, without a value. */
const BOOLEAN_FLAGS = ['no-expand', 'expand', 'dedupe', 'exclude-unavailable']

/** A flag's parse error, ready to print. */
type FlagError = { message: string }

/** Splits "a,b,c" and validates each value against the allowed list. */
function parseList<T extends string>(
	raw: string,
	allowed: readonly T[],
	flag: string,
): T[] | FlagError {
	const values = raw
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean)
	const invalid = values.find((v) => !allowed.includes(v as T))
	if (invalid || values.length === 0) {
		return {
			message: t('errors.invalidFlagValue', {
				flag: `--${flag}`,
				value: invalid ?? raw,
				available: allowed.join(', '),
			}),
		}
	}
	return values as T[]
}

/**
 * Applies the flags over an already built config. Returns the first error
 * found, to stop before opening the browser.
 */
function applyFlags(
	config: ExtractConfig,
	flags: Map<string, string | true>,
): FlagError | null {
	for (const [name, value] of flags) {
		// `--lang`/`--locale` were already consumed by parseLangFlag before i18n.
		if (name === 'lang' || name === 'locale') continue
		if (!VALUE_FLAGS.includes(name) && !BOOLEAN_FLAGS.includes(name)) {
			return { message: t('errors.unknownFlag', { flag: `--${name}` }) }
		}
		const str = typeof value === 'string' ? value : ''

		switch (name) {
			case 'formats': {
				const parsed = parseList(str, FORMATS, name)
				if ('message' in parsed) return parsed
				config.formats = new Set(parsed)
				break
			}
			case 'columns': {
				const parsed = parseList(
					str,
					COLUMNS.map((c) => c.key),
					name,
				)
				if ('message' in parsed) return parsed
				config.columns = parsed
				break
			}
			case 'song-order': {
				const parsed = parseList(str, SONG_ORDERS, name)
				if ('message' in parsed) return parsed
				config.songOrder = parsed[0]
				break
			}
			case 'video-types': {
				const parsed = parseList(str, VIDEO_TYPES, name)
				if ('message' in parsed) return parsed
				config.videoTypeFilter = parsed
				break
			}
			case 'genres': {
				const genres = str
					.split(',')
					.map((g) => g.trim())
					.filter(Boolean)
				if (genres.length === 0) {
					return {
						message: t('errors.invalidFlagValue', {
							flag: `--${name}`,
							value: str,
							available: t('prompts.genreFilterPlaceholder'),
						}),
					}
				}
				config.genreFilter = genres
				break
			}
			case 'long-video-minutes': {
				const minutes = parsePositiveInt(str)
				if (minutes === null) {
					return { message: t('errors.invalidLimit', { value: str }) }
				}
				config.longVideoSeconds = minutes * 60
				break
			}
			case 'expand':
				config.expandAlbums = true
				break
			case 'no-expand':
				config.expandAlbums = false
				break
			case 'dedupe':
				config.dedupe = true
				break
			case 'exclude-unavailable':
				config.excludeUnavailable = true
				break
		}
	}
	return null
}

/**
 * Builds the quick-mode config. Leaving out the limit means "all"; if it's
 * given and isn't an integer ≥ 1, returns the offending value so main() stops
 * with an error instead of processing the whole playlist because of a typo.
 */
function buildQuickConfig(
	positional: string[],
	flags: Map<string, string | true>,
): { config: ExtractConfig } | { invalidLimit: string } | FlagError {
	const config = defaultConfig()
	config.fullUrl = normalizeUrl(positional[0])

	const rawLimit = (positional[1] || process.env.PLAYLIST_MAX || '').trim()
	if (rawLimit) {
		const parsed = parsePositiveInt(rawLimit)
		if (parsed === null) return { invalidLimit: rawLimit }
		config.maxVideos = parsed
		config.allVideos = false
	}

	const flagError = applyFlags(config, flags)
	if (flagError) return flagError
	return { config }
}

async function main(): Promise<void> {
	// The language is resolved separately and first: the errors of the other
	// flags already have to come out translated.
	const { lang } = parseLangFlag(process.argv.slice(2))
	const { flags, rest } = parseFlags(process.argv.slice(2), VALUE_FLAGS)
	const { locale, invalid } = resolveLocale({
		cli: lang,
		env: process.env.PLAYLIST_LANG,
		saved: getSavedLocale(),
		system: osLocale(),
	})
	// Before printing any text, including the errors below.
	await initI18n(locale)

	if (invalid) {
		console.error(
			t('errors.invalidLang', {
				value: invalid,
				available: supportedLocales().join(', '),
			}),
		)
		process.exitCode = 1
		return
	}

	if (rest[0]) {
		const result = buildQuickConfig(rest, flags)
		if ('invalidLimit' in result) {
			console.error(t('errors.invalidLimit', { value: result.invalidLimit }))
			process.exitCode = 1
			return
		}
		if ('message' in result) {
			console.error(result.message)
			process.exitCode = 1
			return
		}
		try {
			await runExtraction(result.config)
		} catch (err) {
			// A nonexistent/private playlist is an expected ending, not a crash:
			// a clear message and exit 1, without the `errors.fatal` stack.
			console.error(t('extract.failed', { message: (err as Error).message }))
			process.exitCode = 1
		}
		return
	}

	// Both ends are required: with stdout on a terminal but stdin redirected
	// (`node src/index.ts < file`), @clack/prompts has nothing to read from.
	if (!process.stdout.isTTY || !process.stdin.isTTY) {
		console.error(t('errors.usage'))
		process.exitCode = 1
		return
	}

	// First run: the language is asked and the answer is persisted.
	// A one-off `--lang` isn't saved: it's a single-run override.
	if (!hasSavedLocale()) {
		await changeLocale(await promptFirstRunLocale(locale))
	}
	await interactiveMenu()
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const meta = import.meta as ImportMeta & { main?: boolean }
const runDirectly =
	typeof meta.main === 'boolean'
		? meta.main // Bun
		: process.argv[1] !== undefined &&
			process.argv[1] === fileURLToPath(import.meta.url) // Node

if (runDirectly) {
	main().catch((err) => {
		console.error(t('errors.fatal'), err)
		process.exit(1)
	})
}
