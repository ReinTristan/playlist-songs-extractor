/**
 * CLI interactivo del extractor de playlists de YouTube.
 *
 * Sin argumentos abre un menú donde se ajustan las opciones y luego se pulsa
 * "Extraer"; al terminar vuelve al menú conservando la configuración, para
 * procesar varias playlists seguidas.
 *
 * Modo rápido (no interactivo):
 *   node src/cli.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *   bun  src/cli.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 */

import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	COLUMNS,
	type ExtractConfig,
	type Format,
	runExtraction,
	type Song,
} from './extractor.ts'

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
	{ value: 'json', label: 'JSON' },
	{ value: 'csv', label: 'CSV' },
	{ value: 'xlsx', label: 'Excel (XLSX)' },
]

/** Config por defecto: todos los formatos, todas las columnas, sin límite. */
function defaultConfig(): ExtractConfig {
	return {
		fullUrl: '',
		maxVideos: Infinity,
		formats: new Set<Format>(['json', 'csv', 'xlsx']),
		expandAlbums: true,
		columns: new Set<keyof Song>(COLUMNS.map((c) => c.key)),
	}
}

/** Acepta una URL completa o un ID de lista y devuelve la URL normalizada. */
function normalizeUrl(raw: string): string {
	const v = raw.trim()
	if (!v) return ''
	return /youtube\.com|youtu\.be/.test(v)
		? v
		: `https://youtube.com/playlist?list=${v}`
}

const maxLabel = (n: number): string =>
	Number.isFinite(n) ? String(n) : 'todos'

// ---------------------------------------------------------------------------
// Editores de cada opción (devuelven true si el usuario canceló → volver al menú)
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
		validate: (v) => {
			const t = v?.trim()
			if (!t || /^todos$/i.test(t)) return undefined
			return /^\d+$/.test(t) && Number(t) >= 1
				? undefined
				: 'Ingresa un entero ≥ 1, o deja vacío para todos'
		},
	})
	if (p.isCancel(raw)) return
	const t = raw.trim()
	config.maxVideos = t === '' || /^todos$/i.test(t) ? Infinity : Number(t)
}

async function editFormats(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: 'Formatos de salida (espacio para alternar)',
		options: FORMAT_OPTIONS,
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
	if (!p.isCancel(sel)) config.columns = new Set(sel)
}

// ---------------------------------------------------------------------------
// Menú principal
// ---------------------------------------------------------------------------

async function interactiveMenu(): Promise<void> {
	const config = defaultConfig()
	p.intro(pc.bgCyan(pc.black(' Playlist Extractor ')))

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
					hint: `${config.columns.size}/${COLUMNS.length}`,
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
			case 'extract': {
				if (!config.fullUrl) {
					p.log.warn('Primero define la URL de la playlist.')
					break
				}
				p.log.step(pc.cyan(`Extrayendo: ${config.fullUrl}`))
				try {
					await runExtraction(config)
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
}

// ---------------------------------------------------------------------------
// Modo rápido por argumentos (compatibilidad hacia atrás)
// ---------------------------------------------------------------------------

function parseLegacyArgs(): ExtractConfig {
	const config = defaultConfig()
	config.fullUrl = normalizeUrl(process.argv[2])
	const limitArg = process.argv[3] || process.env.PLAYLIST_MAX || ''
	config.maxVideos =
		limitArg && Number.isFinite(Number(limitArg)) ? Number(limitArg) : Infinity
	return config
}

async function main(): Promise<void> {
	if (process.argv[2]) {
		await runExtraction(parseLegacyArgs())
	} else {
		await interactiveMenu()
	}
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
		console.error('✖ Error:', err)
		process.exit(1)
	})
}
