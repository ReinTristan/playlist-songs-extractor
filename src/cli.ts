/**
 * Menú interactivo del extractor de playlists de YouTube.
 *
 * Expone `interactiveMenu` (un menú donde se ajustan las opciones y luego se
 * pulsa "Extraer"; al terminar vuelve al menú conservando la configuración,
 * para procesar varias playlists seguidas), `promptFirstRunLocale` (la pregunta
 * de idioma del primer arranque) y `defaultConfig`. El punto de entrada y el
 * modo rápido no interactivo viven en `src/index.ts`.
 *
 * Todo el texto visible sale de `t()`: las opciones se construyen dentro del
 * bucle del menú, así que cambiar de idioma se refleja en el render siguiente.
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { type Browser, chromium } from 'playwright'
import {
	getRecentUrls,
	getSavedConfig,
	pushRecentUrl,
	setSavedConfig,
} from './config.ts'
import { runExtraction } from './extractor.ts'
import {
	changeLocale,
	columnHeader,
	currentLocale,
	formatLabel,
	languageName,
	loadMeta,
	songOrderLabel,
	t,
	videoTypeLabel,
} from './i18n.ts'
import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	LONG_VIDEO_SECONDS,
	SONG_ORDERS,
	type Song,
	VIDEO_TYPES,
} from './types.ts'
import { normalizeUrl, parsePositiveInt } from './utils.ts'

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/**
 * Config por defecto: todos los formatos, todas las columnas, sin límite,
 * con lo que haya quedado guardado de la última corrida encima.
 *
 * Es el único punto donde se lee la config persistida: el modo rápido de
 * `index.ts` parte de acá, así que hereda la preferencia sin código extra.
 */
function defaultConfig(): ExtractConfig {
	// `formats` sale aparte del resto: se persiste como array (un Set no
	// sobrevive al JSON del store), así que si viajara dentro del spread dejaría
	// un Format[] donde va un Set.
	const { formats, ...saved } = getSavedConfig()
	return {
		fullUrl: '',
		allVideos: true,
		maxVideos: 50, // valor inicial del input cuando se elige "definir un número"
		expandAlbums: true,
		columns: COLUMNS.map((c) => c.key),
		songOrder: 'original',
		excludeUnavailable: false,
		longVideoSeconds: LONG_VIDEO_SECONDS,
		dedupe: false,
		videoTypeFilter: null,
		genreFilter: null,
		...saved,
		formats: new Set(formats ?? FORMATS),
	}
}

const maxLabel = (config: ExtractConfig): string =>
	config.allVideos ? t('prompts.maxAll') : String(config.maxVideos)

// ---------------------------------------------------------------------------
// Editores de cada opción (mutan `config` in-place y devuelven Promise<void>;
// si el usuario cancela, dejan el valor como estaba y se vuelve al menú)
// ---------------------------------------------------------------------------

async function editUrl(config: ExtractConfig): Promise<void> {
	// Con historial se ofrece elegir primero: reescribir a mano una URL de
	// playlist es justo lo más tedioso del menú.
	const recent = getRecentUrls()
	if (recent.length > 0) {
		const picked = await p.select({
			message: t('prompts.urlPick'),
			options: [
				...recent.map((u) => ({ value: u, label: u })),
				{ value: '__new', label: t('prompts.urlNew') },
			],
		})
		if (p.isCancel(picked)) return
		if (picked !== '__new') {
			config.fullUrl = normalizeUrl(picked)
			return
		}
	}
	const raw = await p.text({
		message: t('prompts.url'),
		placeholder: t('prompts.urlPlaceholder'),
		initialValue: config.fullUrl,
		validate: (v) => (v?.trim() ? undefined : t('prompts.urlInvalid')),
	})
	if (!p.isCancel(raw)) config.fullUrl = normalizeUrl(raw)
}

/**
 * El límite es una selección (todos / un número) y no un input de texto: así
 * "todos" es el booleano `allVideos` y no una palabra que habría que comparar
 * en cada idioma.
 */
async function editMax(config: ExtractConfig): Promise<void> {
	const mode = await p.select({
		message: t('prompts.maxMode'),
		options: [
			{ value: 'all', label: t('prompts.maxAll') },
			{ value: 'custom', label: t('prompts.maxCustom') },
		],
		initialValue: config.allVideos ? 'all' : 'custom',
	})
	if (p.isCancel(mode)) return
	if (mode === 'all') {
		config.allVideos = true
		return
	}
	const raw = await p.text({
		message: t('prompts.maxNumber'),
		initialValue: String(config.maxVideos),
		validate: (v) =>
			parsePositiveInt(v) === null ? t('prompts.maxInvalid') : undefined,
	})
	if (p.isCancel(raw)) return
	const parsed = parsePositiveInt(raw)
	if (parsed !== null) {
		config.maxVideos = parsed
		config.allVideos = false
	}
}

async function editFormats(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.formats'),
		options: FORMATS.map((f) => ({ value: f, label: formatLabel(f) })),
		initialValues: [...config.formats],
		required: true,
	})
	if (!p.isCancel(sel)) config.formats = new Set(sel)
}

async function editExpand(config: ExtractConfig): Promise<void> {
	const v = await p.confirm({
		message: t('prompts.expand'),
		initialValue: config.expandAlbums,
	})
	if (!p.isCancel(v)) config.expandAlbums = v
}

async function editColumns(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.columns'),
		options: COLUMNS.map((c) => ({ value: c.key, label: columnHeader(c.key) })),
		initialValues: [...config.columns],
		required: true,
	})
	if (p.isCancel(sel)) return
	// Conserva el orden personalizado de las columnas que siguen elegidas y
	// agrega al final (orden canónico) las que se acaban de marcar.
	const selSet = new Set(sel)
	const kept = config.columns.filter((k) => selSet.has(k))
	const added = sel.filter((k) => !kept.includes(k))
	config.columns = [...kept, ...added]
}

async function editColumnOrder(config: ExtractConfig): Promise<void> {
	const order = [...config.columns]

	while (true) {
		const choice = await p.select({
			message: t('prompts.columnOrder'),
			options: [
				...order.map((k, i) => ({
					value: k,
					label: `${i + 1}. ${columnHeader(k)}`,
				})),
				{ value: '__done', label: pc.green(t('prompts.columnOrderDone')) },
			],
		})
		if (p.isCancel(choice) || choice === '__done') break

		const idx = order.indexOf(choice as keyof Song)
		const dir = await p.select({
			message: t('prompts.columnMove', {
				column: columnHeader(choice as keyof Song),
			}),
			options: [
				{ value: 'up', label: t('prompts.moveUp') },
				{ value: 'down', label: t('prompts.moveDown') },
				{ value: 'cancel', label: t('prompts.cancel') },
			],
		})
		if (p.isCancel(dir) || dir === 'cancel') continue
		if (dir === 'up' && idx > 0) {
			;[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
		}
		if (dir === 'down' && idx < order.length - 1) {
			;[order[idx + 1], order[idx]] = [order[idx], order[idx + 1]]
		}
	}
	config.columns = order
}

async function editSongOrder(config: ExtractConfig): Promise<void> {
	const v = await p.select({
		message: t('prompts.songOrder'),
		options: SONG_ORDERS.map((o) => ({ value: o, label: songOrderLabel(o) })),
		initialValue: config.songOrder,
	})
	if (!p.isCancel(v)) config.songOrder = v
}

async function editExcludeUnavailable(config: ExtractConfig): Promise<void> {
	const v = await p.confirm({
		message: t('prompts.excludeUnavailable'),
		initialValue: config.excludeUnavailable,
	})
	if (!p.isCancel(v)) config.excludeUnavailable = v
}

async function editDedupe(config: ExtractConfig): Promise<void> {
	const v = await p.confirm({
		message: t('prompts.dedupe'),
		initialValue: config.dedupe,
	})
	if (!p.isCancel(v)) config.dedupe = v
}

/**
 * Umbral de "video largo". Se pide en minutos (que es como se piensa) y se
 * guarda en segundos, que es lo que compara `classifyVideoType`.
 */
async function editLongVideoMinutes(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: t('prompts.longVideoMinutes'),
		initialValue: String(Math.round(config.longVideoSeconds / 60)),
		validate: (v) =>
			parsePositiveInt(v) === null ? t('prompts.maxInvalid') : undefined,
	})
	if (p.isCancel(raw)) return
	const minutes = parsePositiveInt(raw)
	if (minutes !== null) config.longVideoSeconds = minutes * 60
}

/** Filtro por tipo de video. Elegir todos equivale a no filtrar (`null`). */
async function editVideoTypeFilter(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.videoTypeFilter'),
		options: VIDEO_TYPES.map((v) => ({ value: v, label: videoTypeLabel(v) })),
		initialValues: config.videoTypeFilter ?? [...VIDEO_TYPES],
		required: true,
	})
	if (p.isCancel(sel)) return
	config.videoTypeFilter = sel.length === VIDEO_TYPES.length ? null : sel
}

/**
 * Filtro por género: texto libre separado por comas, no una lista cerrada.
 * `GENRE_KEYWORDS` es la whitelist de *detección*, pero acá lo que importa es
 * lo que quedó en los datos, y vaciar el campo significa "sin filtro".
 */
async function editGenreFilter(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: t('prompts.genreFilter'),
		placeholder: t('prompts.genreFilterPlaceholder'),
		initialValue: config.genreFilter?.join(', ') ?? '',
	})
	if (p.isCancel(raw)) return
	const genres = raw
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean)
	config.genreFilter = genres.length > 0 ? genres : null
}

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------

/**
 * Pregunta del primer arranque. Se arma **solo con `locales/meta.json`** (que
 * trae el nombre nativo y las dos frases en cada idioma), así no hace falta
 * cargar ningún `translation.json` antes de que el usuario elija. Devuelve el
 * código elegido; si cancela, se queda con el detectado.
 */
async function promptFirstRunLocale(detected: string): Promise<string> {
	const { languages } = loadMeta()
	const meta = languages.find((l) => l.code === detected) ?? languages[0]

	const keep = await p.confirm({ message: meta.firstRun.detected })
	if (p.isCancel(keep)) return meta.code
	if (keep) return meta.code

	const chosen = await p.select({
		message: meta.firstRun.choose,
		options: languages.map((l) => ({ value: l.code, label: l.nativeName })),
		initialValue: meta.code,
	})
	return p.isCancel(chosen) ? meta.code : chosen
}

/** Cambio de idioma desde el menú: se aplica en caliente y se persiste. */
async function editLanguage(): Promise<void> {
	const { languages } = loadMeta()
	const chosen = await p.select({
		message: t('prompts.language'),
		options: languages.map((l) => ({ value: l.code, label: l.nativeName })),
		initialValue: currentLocale(),
	})
	if (p.isCancel(chosen)) return
	await changeLocale(chosen)
	p.log.success(t('firstRun.saved', { language: languageName(chosen) }))
}

// ---------------------------------------------------------------------------
// Opciones extra
// ---------------------------------------------------------------------------

/** Resumen corto de las opciones extra activas, para el hint del menú principal. */
function extraSummary(config: ExtractConfig): string {
	const parts: string[] = []
	if (config.songOrder !== 'original') {
		parts.push(songOrderLabel(config.songOrder))
	}
	if (config.excludeUnavailable) parts.push(t('hints.excludeUnavailable'))
	if (config.dedupe) parts.push(t('hints.dedupe'))
	if (config.longVideoSeconds !== LONG_VIDEO_SECONDS) {
		parts.push(
			t('hints.longVideoMinutes', {
				minutes: Math.round(config.longVideoSeconds / 60),
			}),
		)
	}
	if (config.videoTypeFilter) {
		parts.push(config.videoTypeFilter.map(videoTypeLabel).join('/'))
	}
	if (config.genreFilter) parts.push(config.genreFilter.join('/'))
	return parts.length > 0 ? parts.join(', ') : t('hints.none')
}

/** Hint de un filtro: lo elegido, o "sin filtro" cuando es `null`. */
const filterHint = (values: string[] | null): string =>
	values ? values.join(', ') : t('hints.noFilter')

async function extraMenu(config: ExtractConfig): Promise<void> {
	while (true) {
		const action = await p.select({
			message: t('prompts.extra'),
			options: [
				{
					value: 'songOrder',
					label: t('prompts.extraSongOrder'),
					hint: songOrderLabel(config.songOrder),
				},
				{
					value: 'excludeUnavailable',
					label: t('prompts.extraExclude'),
					hint: config.excludeUnavailable ? t('hints.yes') : t('hints.no'),
				},
				{
					value: 'dedupe',
					label: t('prompts.extraDedupe'),
					hint: config.dedupe ? t('hints.yes') : t('hints.no'),
				},
				{
					value: 'longVideo',
					label: t('prompts.extraLongVideo'),
					hint: t('hints.longVideoMinutes', {
						minutes: Math.round(config.longVideoSeconds / 60),
					}),
				},
				{
					value: 'videoTypeFilter',
					label: t('prompts.extraVideoTypeFilter'),
					hint: filterHint(config.videoTypeFilter?.map(videoTypeLabel) ?? null),
				},
				{
					value: 'genreFilter',
					label: t('prompts.extraGenreFilter'),
					hint: filterHint(config.genreFilter),
				},
				{ value: 'back', label: t('prompts.back') },
			],
		})
		if (p.isCancel(action) || action === 'back') return

		switch (action) {
			case 'songOrder':
				await editSongOrder(config)
				break
			case 'excludeUnavailable':
				await editExcludeUnavailable(config)
				break
			case 'dedupe':
				await editDedupe(config)
				break
			case 'longVideo':
				await editLongVideoMinutes(config)
				break
			case 'videoTypeFilter':
				await editVideoTypeFilter(config)
				break
			case 'genreFilter':
				await editGenreFilter(config)
				break
		}
	}
}

// ---------------------------------------------------------------------------
// Menú principal
// ---------------------------------------------------------------------------

async function interactiveMenu(): Promise<void> {
	const config = defaultConfig()
	config.onProgress = (msg) => p.log.step(msg)
	// Un solo Chromium por sesión: se lanza lazy en la primera extracción y se
	// cierra al salir del menú.
	let browser: Browser | null = null
	p.intro(pc.bgCyan(pc.black(t('menu.title'))))

	try {
		while (true) {
			const action = await p.select({
				message: t('menu.prompt'),
				options: [
					{
						value: 'url',
						label: t('menu.url'),
						hint: config.fullUrl || t('hints.unset'),
					},
					{
						value: 'max',
						label: t('menu.max'),
						hint: maxLabel(config),
					},
					{
						value: 'formats',
						label: t('menu.formats'),
						hint: [...config.formats].map(formatLabel).join(', '),
					},
					{
						value: 'expand',
						label: t('menu.expand'),
						hint: config.expandAlbums ? t('hints.yes') : t('hints.no'),
					},
					{
						value: 'columns',
						label: t('menu.columns'),
						hint: `${config.columns.length}/${COLUMNS.length}`,
					},
					{
						value: 'columnOrder',
						label: t('menu.columnOrder'),
						hint: config.columns.map(columnHeader).join(' → '),
					},
					{
						value: 'extra',
						label: t('menu.extra'),
						hint: extraSummary(config),
					},
					{
						value: 'language',
						label: t('menu.language'),
						hint: languageName(currentLocale()),
					},
					{ value: 'extract', label: pc.green(t('menu.extract')) },
					{ value: 'quit', label: t('menu.quit') },
				],
			})

			if (p.isCancel(action) || action === 'quit') {
				p.outro(t('menu.bye'))
				return
			}

			switch (action) {
				case 'url':
					await editUrl(config)
					break
				case 'max':
					await editMax(config)
					break
				case 'formats':
					await editFormats(config)
					break
				case 'expand':
					await editExpand(config)
					break
				case 'columns':
					await editColumns(config)
					break
				case 'columnOrder':
					await editColumnOrder(config)
					break
				case 'extra':
					await extraMenu(config)
					break
				case 'language':
					await editLanguage()
					break
				case 'extract': {
					if (!config.fullUrl) {
						p.log.warn(t('extract.needUrl'))
						break
					}
					p.log.step(pc.cyan(t('extract.starting', { url: config.fullUrl })))
					try {
						browser ??= await chromium.launch({ headless: true })
						await runExtraction(config, browser)
						// Sólo tras una corrida exitosa: no tiene sentido recordar
						// una URL que resultó no existir. (La config se guarda al
						// salir del menú, en el `finally` de abajo.)
						pushRecentUrl(config.fullUrl)
					} catch (err) {
						p.log.error(
							t('extract.failed', { message: (err as Error).message }),
						)
					}
					break
				}
				default: {
					p.log.warn(t('extract.invalidOption'))
				}
			}
		}
	} finally {
		// La config se persiste al salir del menú, no sólo tras extraer: ajustar
		// columnas o formatos y cerrar también es una preferencia, y esperar a
		// una extracción exitosa hacía que se perdiera en cuanto alguien
		// configuraba y salía. `finally` cubre todas las salidas (quit, cancelar
		// con Ctrl+C en un prompt, o una excepción).
		setSavedConfig(config)
		if (browser) await browser.close()
	}
}

export { defaultConfig, interactiveMenu, promptFirstRunLocale }
