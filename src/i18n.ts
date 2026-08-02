/**
 * Internacionalización del CLI y de los archivos exportados.
 *
 * `locales/meta.json` es la única fuente de verdad de qué idiomas existen: se
 * lee síncrono (es chico y local) y alcanza para armar el prompt de primer
 * arranque sin cargar todavía ningún `translation.json`. Los namespaces de
 * traducción los carga i18next-fs-backend bajo demanda, así que solo se leen
 * del disco el idioma elegido y el fallback.
 *
 * Invariante del proyecto: acá vive el texto *visible*. Las keys de `Song` /
 * `COLUMNS` y los valores de datos (`videoType`, `availability`, `mixType`)
 * quedan canónicos en todos los idiomas — la lógica no cambia con el locale.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import Backend from 'i18next-fs-backend'
import { setSavedLocale } from './config.ts'
import type { Format, Song, SongOrder, VideoType } from './types.ts'

// ---------------------------------------------------------------------------
// Catálogo de idiomas (locales/meta.json)
// ---------------------------------------------------------------------------

export interface LanguageMeta {
	code: string
	nativeName: string
	/** Textos del prompt de primer arranque, en ese mismo idioma. */
	firstRun: { detected: string; choose: string }
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

/** Nombre nativo del idioma (para hints del menú); cae al código si no existe. */
export function languageName(code: string): string {
	return languageMeta(code)?.nativeName ?? code
}

// ---------------------------------------------------------------------------
// Resolución del locale
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
 * Precedencia: `--lang` > `PLAYLIST_LANG` > conf > idioma del sistema >
 * fallback. Un idioma pedido explícitamente (cli/env) pero no soportado se
 * devuelve en `invalid` para que el llamador corte con un error; uno del
 * sistema o guardado que ya no exista cae al fallback en silencio.
 *
 * Aun cuando hay `invalid`, se sigue resolviendo el mejor locale disponible:
 * el mensaje de error se muestra en el idioma que el usuario sí entiende, no
 * en el fallback.
 */
export function resolveLocale(sources: LocaleSources): {
	locale: string
	invalid?: string
} {
	const supported = supportedLocales()
	const { fallbackLng } = loadMeta()
	let invalid: string | undefined
	// `invalid` viaja con el resultado en vez de cortar acá: un `--lang=xx`
	// inválido tiene que reportarse aunque otra fuente resuelva un idioma
	// válido para mostrar el mensaje.
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

export async function initI18n(locale: string): Promise<void> {
	if (i18next.isInitialized) {
		await i18next.changeLanguage(locale)
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
		// La salida va a la terminal y a CSV/XLSX, no a HTML.
		interpolation: { escapeValue: false },
	})
}

/** Cambia el idioma en caliente y lo persiste como preferencia del usuario. */
export async function changeLocale(code: string): Promise<void> {
	await i18next.changeLanguage(code)
	setSavedLocale(code)
}

export function currentLocale(): string {
	return i18next.resolvedLanguage ?? i18next.language ?? loadMeta().fallbackLng
}

/**
 * Wrapper fino sobre `i18next.t`: permite importar `t` a nivel de módulo desde
 * `cli.ts`/`extractor.ts` antes de que `initI18n` haya corrido (en ese caso
 * devuelve la key, que es lo que ven los tests unitarios que no inicializan).
 */
export function t(key: string, options?: Record<string, unknown>): string {
	if (!i18next.isInitialized) return key
	return i18next.t(key, options ?? {}) as string
}

// ---------------------------------------------------------------------------
// Labels de las constantes de dominio (types.ts queda sin texto visible)
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
 * Label del tipo de video. Sólo para la UI del filtro: el valor que va al
 * export sigue siendo la key canónica ('single', 'album', 'mix', 'unknown'),
 * para que dos corridas en idiomas distintos sigan siendo comparables.
 */
export function videoTypeLabel(value: VideoType): string {
	return t(`videoTypes.${value}`)
}
