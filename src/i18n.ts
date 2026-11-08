/**
 * Internationalization of the CLI and of the exported files.
 *
 * `locales/meta.json` is the single source of truth for which languages exist:
 * it's read synchronously (it's small and local) and is enough to build the
 * first-run prompt without loading any `translation.json` yet. The translation
 * namespaces are loaded on demand by i18next-fs-backend, so only the chosen
 * language and the fallback are read from disk.
 *
 * Project invariant: *visible* text lives here. The `Song` / `COLUMNS` keys and
 * the data values (`videoType`, `availability`, `mixType`) stay canonical in
 * every language — the logic doesn't change with the locale.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MULTISELECT_INSTRUCTIONS, SELECT_INSTRUCTIONS } from '@clack/prompts'
import i18next from 'i18next'
import Backend from 'i18next-fs-backend'
import pc from 'picocolors'
import { setSavedLocale } from './config.ts'
import type { Format, Song, SongOrder, VideoType } from './types.ts'

// ---------------------------------------------------------------------------
// Language catalog (locales/meta.json)
// ---------------------------------------------------------------------------

export interface LanguageMeta {
	code: string
	nativeName: string
	/** The first-run prompt's strings, in that same language. */
	firstRun: { detected: string; choose: string; yes: string; no: string }
}

export interface LocaleMeta {
	fallbackLng: string
	languages: LanguageMeta[]
}

const LOCALES_DIR = path.join(import.meta.dirname, '..', 'locales')

let metaCache: LocaleMeta | null = null

export function loadMeta(): LocaleMeta {
	metaCache ??= JSON.parse(
		readFileSync(path.join(LOCALES_DIR, 'meta.json'), 'utf8'),
	) as LocaleMeta
	return metaCache
}

export function supportedLocales(): string[] {
	return loadMeta().languages.map((l) => l.code)
}

export function languageMeta(code: string): LanguageMeta | undefined {
	return loadMeta().languages.find((l) => l.code === code)
}

/** The language's native name (for menu hints); falls back to the code if missing. */
export function languageName(code: string): string {
	return languageMeta(code)?.nativeName ?? code
}

// ---------------------------------------------------------------------------
// Locale resolution
// ---------------------------------------------------------------------------

/** "es-AR"/"es_AR" → "es". */
function normalize(raw: string | undefined | null): string | undefined {
	const v = (raw ?? '').trim()
	if (!v) return undefined
	return v.split(/[-_]/)[0].toLowerCase()
}

export interface LocaleSources {
	cli?: string // --lang=<code>
	env?: string // PLAYLIST_LANG
	saved?: string // conf
	system?: string // osLocale()
}

/**
 * Precedence: `--lang` > `PLAYLIST_LANG` > conf > system language > fallback.
 * A language asked for explicitly (cli/env) but not supported is returned in
 * `invalid` so the caller stops with an error; a system or saved one that no
 * longer exists silently falls back.
 *
 * Even when there's an `invalid`, the best available locale is still resolved:
 * the error message is shown in the language the user does understand, not in
 * the fallback.
 */
export function resolveLocale(sources: LocaleSources): {
	locale: string
	invalid?: string
} {
	const supported = supportedLocales()
	const { fallbackLng } = loadMeta()
	let invalid: string | undefined
	// `invalid` travels with the result instead of stopping here: an invalid
	// `--lang=xx` has to be reported even if another source resolves a valid
	// language to show the message in.
	const result = (locale: string) =>
		invalid === undefined ? { locale } : { locale, invalid }

	for (const raw of [sources.cli, sources.env]) {
		const code = normalize(raw)
		if (!code) continue
		if (supported.includes(code)) return result(code)
		invalid ??= (raw ?? '').trim()
	}

	for (const raw of [sources.saved, sources.system]) {
		const code = normalize(raw)
		if (code && supported.includes(code)) return result(code)
	}

	return result(fallbackLng)
}

// ---------------------------------------------------------------------------
// i18next
// ---------------------------------------------------------------------------

/**
 * Translates clack's help footers ("↑/↓ to navigate • Enter: confirm"). Clack
 * has no option for that, but it exports the arrays it reads on every render:
 * they're rewritten **in place** (not reassigned, because clack keeps the
 * reference) every time the language changes.
 */
export function localizeClack(): void {
	const navigate = t('clack.navigate', { keys: pc.dim('↑/↓') })
	const confirm = t('clack.confirm', { key: pc.dim(t('clack.enterKey')) })
	const select = t('clack.select', { key: pc.dim(t('clack.spaceKey')) })
	SELECT_INSTRUCTIONS.splice(0, SELECT_INSTRUCTIONS.length, navigate, confirm)
	MULTISELECT_INSTRUCTIONS.splice(
		0,
		MULTISELECT_INSTRUCTIONS.length,
		navigate,
		select,
		confirm,
	)
}

export async function initI18n(locale: string): Promise<void> {
	if (i18next.isInitialized) {
		await i18next.changeLanguage(locale)
		localizeClack()
		return
	}
	const { fallbackLng } = loadMeta()
	await i18next.use(Backend).init({
		lng: locale,
		fallbackLng,
		supportedLngs: supportedLocales(),
		ns: ['translation'],
		defaultNS: 'translation',
		backend: {
			loadPath: path.join(LOCALES_DIR, '{{lng}}', 'translation.json'),
		},
		// The output goes to the terminal and to CSV/XLSX, not to HTML.
		interpolation: { escapeValue: false },
	})
	localizeClack()
}

/** Switches the language on the fly and persists it as the user's preference. */
export async function changeLocale(code: string): Promise<void> {
	await i18next.changeLanguage(code)
	localizeClack()
	setSavedLocale(code)
}

export function currentLocale(): string {
	return i18next.resolvedLanguage ?? i18next.language ?? loadMeta().fallbackLng
}

/**
 * Thin wrapper over `i18next.t`: lets `cli.ts`/`extractor.ts` import `t` at
 * module level before `initI18n` has run (in that case it returns the key,
 * which is what the unit tests that don't initialize see).
 */
export function t(key: string, options?: Record<string, unknown>): string {
	if (!i18next.isInitialized) return key
	return i18next.t(key, options ?? {}) as string
}

// ---------------------------------------------------------------------------
// Labels for the domain constants (types.ts stays free of visible text)
// ---------------------------------------------------------------------------

export function columnHeader(key: keyof Song): string {
	return t(`columns.${key}`)
}

export function formatLabel(value: Format): string {
	return t(`formats.${value}`)
}

export function songOrderLabel(value: SongOrder): string {
	return t(`songOrders.${value}`)
}

/**
 * The video type's label. Only for the filter UI: the value that goes into the
 * export is still the canonical key ('single', 'album', 'mix', 'unknown'), so
 * two runs in different languages stay comparable.
 */
export function videoTypeLabel(value: VideoType): string {
	return t(`videoTypes.${value}`)
}
