/**
 * Pure, generic helpers, with no dependency on Playwright, the interactive
 * menu or the domain types. Shared by the CLI, the extractor and the debug
 * script; several are tested directly in tests/.
 */

/** Waits `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

/** Accepts a full URL or a playlist ID and returns the normalized URL. */
export function normalizeUrl(raw: string): string {
	const v = raw.trim()
	if (!v) return ''
	if (!/youtube\.com|youtu\.be/.test(v)) {
		return `https://youtube.com/playlist?list=${v}`
	}
	return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/**
 * Parses a video limit: digits only, integer ≥ 1. Anything else (empty, "0",
 * negatives, text) returns null.
 *
 * "All" is no longer expressed as a word (that didn't scale to several
 * languages) but with `ExtractConfig`'s `allVideos` boolean: in the menu it's a
 * choice, and in quick mode it's simply leaving the argument out.
 */
export function parsePositiveInt(
	raw: string | undefined | null,
): number | null {
	const t = (raw ?? '').trim()
	if (!/^\d+$/.test(t)) return null
	const n = Number(t)
	return n >= 1 ? n : null
}

/**
 * Splits the `--flags` out of argv, in any position, so the positional
 * arguments (URL, limit) can still be read by index.
 *
 * Accepts `--flag=value` and `--flag value`; the latter only for the names
 * listed in `valueFlags`, because otherwise a boolean flag would swallow the
 * next positional (`--dedupe "URL"` would take the URL as its value).
 * Flags without a value become `true`.
 */
export function parseFlags(
	argv: string[],
	valueFlags: string[] = [],
): { flags: Map<string, string | true>; rest: string[] } {
	const flags = new Map<string, string | true>()
	const rest: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const inline = arg.match(/^--([^=]+)=(.*)$/)
		if (inline) {
			flags.set(inline[1], inline[2])
			continue
		}
		const bare = arg.match(/^--(.+)$/)
		if (bare) {
			const name = bare[1]
			if (valueFlags.includes(name) && i + 1 < argv.length) {
				flags.set(name, argv[i + 1])
				i++ // consume the value
			} else {
				flags.set(name, true)
			}
			continue
		}
		rest.push(arg)
	}
	return { flags, rest }
}

/**
 * Historical shortcut over `parseFlags` for the language: `--lang=<code>` /
 * `--lang <code>` (or `--locale`). It's resolved apart from the other flags
 * because the language has to be known before printing any message,
 * including the errors of the other options.
 */
export function parseLangFlag(argv: string[]): {
	lang?: string
	rest: string[]
} {
	const rest: string[] = []
	let lang: string | undefined
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const inline = arg.match(/^--(?:lang|locale)=(.*)$/)
		if (inline) {
			lang = inline[1]
			continue
		}
		if (/^--(?:lang|locale)$/.test(arg)) {
			lang = argv[i + 1]
			i++ // consume the value
			continue
		}
		rest.push(arg)
	}
	return { lang, rest }
}

/** Converts "h:mm:ss" or "mm:ss" to seconds. */
export function durationToSeconds(duration: string): number {
	const parts = duration.split(':').map((p) => parseInt(p.trim(), 10))
	if (parts.some((n) => Number.isNaN(n)) || parts.length === 0) return 0
	return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Sanitizes a name so it can be used as a folder/file name. */
export function sanitizeFilename(name: string): string {
	return (
		name
			.replace(/[<>:"/\\|?*]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'playlist'
	)
}

/**
 * Escapes a string's metacharacters so it can be interpolated into a RegExp as
 * literal text. Used by title parsing, which builds its patterns from keyword
 * lists (genres, mix types) where any entry may contain `&`, `+`, `.` or
 * parentheses.
 */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Returns a shuffled copy of the array (Fisher–Yates), without mutating the original. */
export function shuffle<T>(arr: T[]): T[] {
	const out = [...arr]
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[out[i], out[j]] = [out[j], out[i]]
	}
	return out
}

//Borrowed from sindresorhus/os-locale, ty
export function osLocale(env = globalThis.process?.env ?? {}) {
	const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE

	if (locale) {
		return locale
			.replace(/[.:].*/, '')
			.replace(/@.*/, '')
			.replace(/_/, '-')
	}

	return new Intl.DateTimeFormat().resolvedOptions().locale
}
