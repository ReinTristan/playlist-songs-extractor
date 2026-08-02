/**
 * Preferencias persistentes del usuario (idioma, última configuración usada y
 * URLs recientes).
 *
 * Envuelve `conf` para que el resto del código no dependa de su API. El store
 * se crea de forma perezosa: importar este módulo no debe tocar el disco (a
 * `src/index.ts` lo spawnean los tests). `PLAYLIST_CONFIG_DIR` permite apuntar
 * el store a un directorio temporal en las pruebas.
 *
 * Todo lo que se guarda pasa por `sanitizeConfig` al leerse: un archivo escrito
 * por una versión anterior puede traer columnas o formatos que ya no existen, y
 * usarlos tal cual rompería la salida en silencio.
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

/** Cuántas URLs de playlist se recuerdan para ofrecerlas en el menú. */
const MAX_RECENT_URLS = 10

/**
 * Config tal como se serializa a JSON: `formats` viaja como array porque un
 * `Set` no sobrevive al round-trip, y `fullUrl`/`onProgress` no se guardan (uno
 * vive en `recentUrls`, el otro es una función).
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

/** Locale guardado en una corrida anterior, o `undefined` si nunca se eligió. */
export function getSavedLocale(): string | undefined {
	return getStore().get('locale')
}

export function setSavedLocale(locale: string): void {
	getStore().set('locale', locale)
}

/** `false` la primera vez que se abre el CLI: dispara el prompt de idioma. */
export function hasSavedLocale(): boolean {
	return getStore().has('locale')
}

/** Ruta del archivo de configuración (para mostrarla en el CLI). */
export function configPath(): string {
	return getStore().path
}

// ---------------------------------------------------------------------------
// Última configuración usada
// ---------------------------------------------------------------------------

const isValidArray = <T>(value: unknown, allowed: readonly T[]): value is T[] =>
	Array.isArray(value) && value.every((v) => allowed.includes(v as T))

/**
 * Descarta del objeto guardado todo lo que no reconozca la versión actual y
 * devuelve sólo las claves válidas, para mergearlas sobre los defaults.
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

	// Las listas se filtran en vez de descartarse enteras: si desapareció una
	// sola columna, el resto del orden elegido sigue siendo válido.
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

/** Config de la última corrida, ya saneada. Vacío si nunca se guardó nada. */
export function getSavedConfig(): Partial<PersistedConfig> {
	return sanitizeConfig(getStore().get('lastConfig'))
}

/** Guarda la config de una extracción (sin la URL, que va a `recentUrls`). */
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
// URLs recientes
// ---------------------------------------------------------------------------

export function getRecentUrls(): string[] {
	const raw = getStore().get('recentUrls')
	if (!Array.isArray(raw)) return []
	return raw
		.filter((u) => typeof u === 'string' && u.trim())
		.slice(0, MAX_RECENT_URLS)
}

/** Agrega una URL al historial: más reciente primero, sin repetidos. */
export function pushRecentUrl(url: string): void {
	const clean = url.trim()
	if (!clean) return
	const next = [clean, ...getRecentUrls().filter((u) => u !== clean)].slice(
		0,
		MAX_RECENT_URLS,
	)
	getStore().set('recentUrls', next)
}
