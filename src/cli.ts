/**
 * Menú interactivo del extractor de playlists de YouTube.
 *
 * Expone `interactiveMenu` (un menú donde se ajustan las opciones y luego se
 * pulsa "Extraer"; al terminar vuelve al menú conservando la configuración,
 * para procesar varias playlists seguidas) y `defaultConfig`. El punto de
 * entrada y el modo rápido no interactivo viven en `src/index.ts`.
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { type Browser, chromium } from 'playwright'
import { runExtraction } from './extractor.ts'
import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	type Format,
	SONG_ORDERS,
	type Song,
} from './types.ts'
import { normalizeUrl, parseMaxVideos } from './utils.ts'

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Config por defecto: todos los formatos, todas las columnas, sin límite. */
function defaultConfig(): ExtractConfig {
	return {
		fullUrl: '',
		maxVideos: Infinity,
		formats: new Set<Format>(FORMATS.map((f) => f.value)),
		expandAlbums: true,
		columns: COLUMNS.map((c) => c.key),
		songOrder: 'original',
		excludeUnavailable: false,
	}
}

const maxLabel = (n: number): string =>
	Number.isFinite(n) ? String(n) : 'todos'

// ---------------------------------------------------------------------------
// Editores de cada opción (mutan `config` in-place y devuelven Promise<void>;
// si el usuario cancela, dejan el valor como estaba y se vuelve al menú)
// ---------------------------------------------------------------------------

async function editUrl(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: 'URL o ID de la playlist de YouTube',
		placeholder: 'https://www.youtube.com/playlist?list=...',
		initialValue: config.fullUrl,
		validate: (v) => (v?.trim() ? undefined : 'Ingresa una URL o ID'),
	})
	if (!p.isCancel(raw)) config.fullUrl = normalizeUrl(raw)
}

async function editMax(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: 'Límite de videos (vacío o "todos" = sin límite)',
		initialValue: Number.isFinite(config.maxVideos)
			? String(config.maxVideos)
			: '',
		validate: (v) =>
			parseMaxVideos(v) === null
				? 'Ingresa un entero ≥ 1, o deja vacío para todos'
				: undefined,
	})
	if (p.isCancel(raw)) return
	const parsed = parseMaxVideos(raw)
	if (parsed !== null) config.maxVideos = parsed
}

async function editFormats(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: 'Formatos de salida (espacio para alternar)',
		options: [...FORMATS],
		initialValues: [...config.formats],
		required: true,
	})
	if (!p.isCancel(sel)) config.formats = new Set(sel)
}

async function editExpand(config: ExtractConfig): Promise<void> {
	const v = await p.confirm({
		message: '¿Expandir álbumes/mixes largos en canciones individuales?',
		initialValue: config.expandAlbums,
	})
	if (!p.isCancel(v)) config.expandAlbums = v
}

async function editColumns(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: 'Columnas a guardar (espacio para alternar)',
		options: COLUMNS.map((c) => ({ value: c.key, label: c.header })),
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

const columnLabel = (k: keyof Song): string => {
	const label = COLUMNS.find((c) => c.key === k)
	//Return first label as default
	return label?.header ?? COLUMNS[0].header
}

async function editColumnOrder(config: ExtractConfig): Promise<void> {
	const order = [...config.columns]

	while (true) {
		const choice = await p.select({
			message: 'Reordenar columnas (elige una para moverla, o termina)',
			options: [
				...order.map((k, i) => ({
					value: k,
					label: `${i + 1}. ${columnLabel(k)}`,
				})),
				{ value: '__done', label: pc.green('✔ Listo') },
			],
		})
		if (p.isCancel(choice) || choice === '__done') break

		const idx = order.indexOf(choice as keyof Song)
		const dir = await p.select({
			message: `Mover "${columnLabel(choice as keyof Song)}"`,
			options: [
				{ value: 'up', label: '↑ Subir' },
				{ value: 'down', label: '↓ Bajar' },
				{ value: 'cancel', label: 'Cancelar' },
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
		message: 'Orden de las canciones en el output',
		options: SONG_ORDERS.map((o) => ({ value: o.value, label: o.label })),
		initialValue: config.songOrder,
	})
	if (!p.isCancel(v)) config.songOrder = v
}

async function editExcludeUnavailable(config: ExtractConfig): Promise<void> {
	const v = await p.confirm({
		message:
			'¿Excluir canciones no disponibles (privadas/borradas) del output?',
		initialValue: config.excludeUnavailable,
	})
	if (!p.isCancel(v)) config.excludeUnavailable = v
}

/** Resumen corto de las opciones extra activas, para el hint del menú principal. */
function extraSummary(config: ExtractConfig): string {
	const parts: string[] = []
	if (config.songOrder !== 'original') {
		parts.push(
			SONG_ORDERS.find((o) => o.value === config.songOrder)?.label ??
				SONG_ORDERS[0].label,
		)
	}
	if (config.excludeUnavailable) parts.push('excluir no disp.')
	return parts.length > 0 ? parts.join(', ') : 'ninguna activa'
}

async function extraMenu(config: ExtractConfig): Promise<void> {
	while (true) {
		const action = await p.select({
			message: 'Opciones extra (experimentales, desactivadas por defecto)',
			options: [
				{
					value: 'songOrder',
					label: 'Orden de canciones',
					hint:
						SONG_ORDERS.find((o) => o.value === config.songOrder)?.label ??
						SONG_ORDERS[0].label,
				},
				{
					value: 'excludeUnavailable',
					label: 'Excluir no disponibles',
					hint: config.excludeUnavailable ? 'sí' : 'no',
				},
				{ value: 'back', label: '← Volver al menú principal' },
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
	p.intro(pc.bgCyan(pc.black(' Playlist Extractor ')))

	try {
		while (true) {
			const action = await p.select({
				message: 'Ajusta las opciones y luego extrae',
				options: [
					{
						value: 'url',
						label: 'URL de la playlist',
						hint: config.fullUrl || 'sin definir',
					},
					{
						value: 'max',
						label: 'Límite de videos',
						hint: maxLabel(config.maxVideos),
					},
					{
						value: 'formats',
						label: 'Formatos de salida',
						hint: [...config.formats].join(', '),
					},
					{
						value: 'expand',
						label: 'Expandir álbumes/mixes',
						hint: config.expandAlbums ? 'sí' : 'no',
					},
					{
						value: 'columns',
						label: 'Columnas a guardar',
						hint: `${config.columns.length}/${COLUMNS.length}`,
					},
					{
						value: 'columnOrder',
						label: 'Orden de columnas',
						hint: config.columns.map(columnLabel).join(' → '),
					},
					{
						value: 'extra',
						label: 'Opciones extra',
						hint: extraSummary(config),
					},
					{ value: 'extract', label: pc.green('▶ Extraer') },
					{ value: 'quit', label: 'Salir' },
				],
			})

			if (p.isCancel(action) || action === 'quit') {
				p.outro('¡Hasta luego!')
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
				case 'extract': {
					if (!config.fullUrl) {
						p.log.warn('Primero define la URL de la playlist.')
						break
					}
					p.log.step(pc.cyan(`Extrayendo: ${config.fullUrl}`))
					try {
						browser ??= await chromium.launch({ headless: true })
						await runExtraction(config, browser)
					} catch (err) {
						p.log.error(`Error en la extracción: ${(err as Error).message}`)
					}
					break
				}
				default: {
					p.log.warn('Selecciona una opcion valida')
				}
			}
		}
	} finally {
		if (browser) await browser.close()
	}
}

export { defaultConfig, interactiveMenu }
